/**
 * Name: sns_criterion_response
 * Description:  Triggered when a SNS response for application
 *   sdoe.usf.criterion is received.
 *
 *
 * @module sns_criterion_response
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
    let application = attrs['application'].Value;
    let bucket = attrs['response-s3bucket'].Value;
    let criterion_id = attrs['criterion-id'].Value;
    let candidates_length = attrs['candidates-length'].Value;
    let attrs_event = attrs['event'].Value;

    if (application != 'sdoe.usf.criterion') {
      console.log(`IGNORE application=${application}`);
      continue;
    }

    if (attrs_event== "success") {
      console.log(`success application=${application}`);
      let output = JSON.parse(record.Sns.Message);
      let key = `${username}/criterion/${criterion_id}/success.json`
      let params = {
          Bucket: bucket,
          Key: key,
          Body: output
      };
      let command;
      command = new PutObjectCommand(params);
      let response = await client.send(command);
    } else if (attrs_event == "error") {
      console.log(`error application=${application}`);
      let output = JSON.parse(record.Sns.Message);
      let key = `${username}/criterion/${criterion_id}/error.json`
      let params = {
          Bucket: bucket,
          Key: key,
          Body: output
      };
      let command;
      command = new PutObjectCommand(params);
      let response = await client.send(command);
    } else {
      console.log('ignore message');
      console.log(`IGNORE: MessageId=${record.MessageId} Event=${attrs_event}`);
      continue;
    }
  }
  return 1;
};
