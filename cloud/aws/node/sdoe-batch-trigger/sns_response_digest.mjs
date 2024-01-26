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
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

const client = new S3Client({});
const sns_client = new SNSClient({});
const sdoe_batch_topic_arn = process.env.SDOE_BATCH_TOPIC_ARN;
const sdoe_batch_response_bucket = process.env.SDOE_RESPONSE_BUCKET_NAME;

/**
 * key s3://{bucket_name}/request/{username}/{batch_uuid}.json
**/
export const handler = async (event, context) => {
  console.log(`EVENT: ${JSON.stringify(event)}`);
  if (!event.Records) {
    console.log('Finished: No SNS Records');
    return;
  }
  for (var j = 0; j < event.Records.length; j++) {
    let record = event.Records[j];
    let attrs = record.Sns.MessageAttributes;
    let username = attrs.username.Value;
    let ts = record.Sns.Timestamp;
    let bucket = attrs['response-s3bucket'].Value;
    let batch_id = attrs['batch-id'].Value;
    let batch_length = attrs['batch-length'].Value;
    let batch_index = attrs['batch-index'].Value;
    if (attrs.event.Value == "success") {
      let output = JSON.parse(record.Sns.Message);
      let key = `${batch_id}/${batch_length}/success/${batch_index}.json`
      let params = {
          Bucket: bucket,
          Key: key,
          Body: output
      };
      let command;
      command = new PutObjectCommand(params);
      let response = await client.send(command);
    } else if (attrs.event.Value == "error") {
      let output = JSON.parse(record.Sns.Message);
      let key = `${batch_id}/${batch_length}/error/${batch_index}.json`
      let params = {
          Bucket: bucket,
          Key: key,
          Body: output
      };
      let command;
      command = new PutObjectCommand(params);
      let response = await client.send(command);
    } else {
      console.log(`IGNORE: MessageId=${record.MessageId} Event=${attrs.event.Value}`);
      continue;
    }
  }
  return 1;
};
