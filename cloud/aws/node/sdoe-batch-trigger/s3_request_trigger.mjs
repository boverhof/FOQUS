/**
 * Name: s3_request_trigger
 * Description:  Triggered when a request JSON file is created in bucket
 *
 * @module s3_request_trigger
 * @author Joshua Boverhof <jrboverhof@lbl.gov>
 * @version 2.0
 * @license See LICENSE.md
 */
import * as path from 'path';
//import * as validate from 'uuid-validate';
import { HeadObjectCommand, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

const client = new S3Client({});
const sns_client = new SNSClient({});
const sdoe_batch_topic_arn = process.env.SDOE_BATCH_TOPIC_ARN;
const sdoe_batch_response_bucket = process.env.SDOE_RESPONSE_BUCKET_NAME;

/**
 * key s3://{bucket_name}/request/{username}/{batch_uuid}.json
**/
export const handler = async (event, context) => {
    if ( event.Records.length != 1 ) {
      throw new Error(`Unexpected Records Length: ${event.Records.length}`);
    }
    const bucket = event.Records[0].s3.bucket.name;
    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
    const params = {
        Bucket: bucket,
        Key: key,
    };
    //const key_array = key.split('/');
    //const username = key.split('/')[4];
    //const batch_id = key.split('/')[5].strip('.json');
    const keypath = path.parse(key);
    const username = keypath.dir.split('/')[1];
    const batch_id = keypath.name;
    // if ( !validate(batch_id)) {
    //   throw new Error(`s3 batch request (${bucket}:${key}) bad batch UUID id=${batch_id}`);
    // }
    console.log(`sdoe_batch_topic_arn: ${sdoe_batch_topic_arn}`);

    let command;
    command = new GetObjectCommand(params);
    let obj;
    try {
        const getobject_response = await client.send(command);
        const stream_tostring = await getobject_response.Body?.transformToString();
        obj = JSON.parse(stream_tostring);
    } catch (err) {
        console.log(err);
        const message = `Error getting object ${key} from bucket ${bucket}. Make sure they exist and your bucket is in the same region as this function.`;
        console.log(message);
        throw new Error(message);
    }
    console.log(`Keys: ${Object.keys(obj)}`);
    console.log(`Length: ${obj.input.length}`);
    console.log(`ID: ${obj.id}`);
    //"application":"sdoe.usf.compute_min_dist",
    //"id":"2febbd12-f343-4c5b-981e-bef849690040",
    if ( !obj.application.startsWith('sdoe.')) {
      throw new Error(`s3 batch request (${bucket}:${key}) bad attribute application=${obj.application}`);
    }
    for (var idx = 0; idx < obj.input.length; idx++) {
      let input = obj.input[idx];
      console.log(`SNS Publish: ${idx}`);
      var response = await sns_client.send(
        new PublishCommand({
          TopicArn: sdoe_batch_topic_arn,
          Message: JSON.stringify(input),
          MessageAttributes: {
            'request-s3key': {
              DataType: 'String',
              StringValue: key
            },
            'request-s3bucket': {
              DataType: 'String',
              StringValue: bucket
            },
            'response-s3bucket': {
              DataType: 'String',
              StringValue: sdoe_batch_response_bucket
            },
            'batch-id': {
              DataType: 'String',
              StringValue: batch_id
            },
            'batch-index': {
              DataType: 'String',
              StringValue: idx.toString()
            },
            'username': {
              DataType: 'String',
              StringValue: username
            },
            'event': {
              DataType: 'String',
              StringValue: 'submit'
            },
            'application': {
              DataType: 'String',
              StringValue: obj.application
            }
          }
        }),
      );
    }
    return 1;
};
