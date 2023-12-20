/**
 * Lambda Function, lists all files with S3 Prefix s3://bucket/{session_id}/create,
 *   get each file which contains a JSON array of job descriptions and Publish
 *   each job to the FOQUS Update Notification topic where the lambda function
 *   foqus-sns-update is listening.  Delete all S3 Objects processed.
 *
 * @module post-session-start
 * @author Joshua Boverhof <jrboverhof@lbl.gov>
 * @version 1.0
 * @license See LICENSE.md
 * @see https://github.com/motdotla/node-lambda-template
 */
'use strict';
'use AWS.S3';
const log = require("debug")("post-session-start");
const AWS = require('aws-sdk');
//const s3 = require('s3');
//const fs = require('fs');
//const dirPath = "./tmp";
//const path = require('path');
//const abspath = path.resolve(dirPath);
const s3_bucket_name = process.env.SESSION_BUCKET_NAME;
//const { v4: uuidv4 } = require('uuid');
const foqus_update_topic = process.env.FOQUS_UPDATE_TOPIC;
const s3 = new AWS.S3();
const sns = new AWS.SNS();
var id_list = [];

// post-session-start:
//  1.  Grab oldest S3 File in bucket foqus-sessions/{username}/{session_uuid}/*.json
//  2.  Send each job to SNS Job Topic
//  3.  Update DynamoDB TurbineResources table UUID for each job, State=submit, Submit=MS_SINCE_EPOCH
//  4.  Go back to 1


// finalize_session_event_start:  Called last, sends msg to sns update job topic
//   All jobs have been processed from the S3 create session
//   This SNS msg will move jobs in state=stop to state=submit, logs
//   the event, increments metrics.

exports.handler = function(event, context, callback) {
  log(`Running index.handler: "${event.httpMethod}"`);
  log("request: " + JSON.stringify(event));
  if (event.requestContext == null) {
      context.fail("No requestContext for user mapping");
      callback(null, {statusCode:'500', body: "No requestContext for user mapping",
        headers: {'Access-Control-Allow-Origin': '*','Content-Type': 'application/json'}
      });
      return;
  }
  if (event.requestContext.authorizer == null) {
      log("API Gateway Testing");
      var content = JSON.stringify([]);
      callback(null, {statusCode:'200', body: content,
        headers: {'Access-Control-Allow-Origin': '*','Content-Type': 'application/json'}
      });
      return;
  }
  if (event.httpMethod != "POST") {
      context.fail(`Unsupported method "${event.httpMethod}"`);
      callback(null, {statusCode:'400', body: new Error(`Unsupported method "${event.httpMethod}"`),
        headers: {'Access-Control-Allow-Origin': '*','Content-Type': 'application/json'}
      });
      return;
  }
  const user_name = event.requestContext.authorizer.principalId;
  const session_id = event.path.split('/')[2];
  var topic_arn;
  log("PATH: " + event.path);
  log("SESSIONID: " + session_id);
  log("SESSION BUCKET_NAME: " + s3_bucket_name);

  function handleError(error) {
    log(`handleError ${error.name}  ${error}`);
    callback(null, {statusCode:'400',  body: `Failed to append jobs: ${error}`,
      headers: {'Access-Control-Allow-Origin': '*','Content-Type': 'application/json'}
    });
  };
  function handleDone() {
    log("handleDone");
    callback(null, {statusCode:'200', body: JSON.stringify(id_list),
      headers: {'Access-Control-Allow-Origin': '*','Content-Type': 'application/json'}
    });
  };
  function deleteS3Object(s3_key, response) {
    log(`Delete: bucket=${s3_bucket_name} key=${s3_key}`);
    let params_delete = {Bucket: s3_bucket_name, Delete:{Objects:[{Key:s3_key}]}};
    let promise = s3.deleteObjects(params_delete, function(err, data) {
        if (err) {
            log(`handleDelete(${params_delete.Delete.Objects.length}), ERROR: ${err}`);
            log(`handleDelete ERROR Stack: ${err.stack}`);
        } else {
            log(`handleDelete: DELETED ${JSON.stringify(params_delete)}`);
        }
    });
    return promise;
  };
  function handleS3Object(s3_key, topic_arn, response) {
    let values = JSON.parse(response.Body.toString('utf-8'));
    log(`handleS3Object values(${s3_key}): ${values.length}`);
    var promise_sns_list = [];
    for (var index=0 ; index < values.length; index++ ) {
        let obj = values[index];
        log(`SESSION(${session_id}, ${index}):  Notify Starting job=${obj.Id}`);
        id_list.push(obj['Id']);
        obj.resource = 'job';
        obj.status = 'submit';
        obj.jobid = obj.Id;
        obj.sessionid = session_id;
        obj.event = 'status';
        let payload = JSON.stringify(obj);
        let params_sns = {
            Message: payload,
            MessageAttributes: {
              'event': {
                DataType: 'String',
                StringValue: 'job.submit'
              },
              'session': {
                DataType: 'String',
                StringValue: session_id
              },
              'job': {
                DataType: 'String',
                StringValue: obj.Id
              },
              'username': {
                DataType: 'String',
                StringValue: user_name
              },
              'application': {
                DataType: 'String',
                StringValue: obj.Application || 'foqus'
              }
            },
            TopicArn: topic_arn
        };
        let promise_sns = sns.publish(params_sns, function(err, data) {
            if (err) {
              log(`SNS Publish error session=${params_sns.MessageAttributes.session.StringValue}, job=${params_sns.MessageAttributes.job.StringValue}`);
              log(err, err.stack); // an error occurred
              throw new Error(`SNS Publish error session=${params_sns.MessageAttributes.session.StringValue}, job=${params_sns.MessageAttributes.job.StringValue}`);
            } else {
              log(`SNS Publish session=${params_sns.MessageAttributes.session.StringValue}, job=${params_sns.MessageAttributes.job.StringValue}`);
            }
        });
        promise_sns_list.push(promise_sns);
    }
    log(`SNS Publish promises len=${promise_sns_list.length}`);
    return Promise.all(promise_sns_list);
  };
  //log("S3 listObjects Contents: length="+ response_list.data.Contents.length);
  //function handleS3ObjectList(response_topic, response_list) {
  function handleS3ObjectList(values) {
    log(`handleS3ObjectList: ${JSON.stringify(values)}`)
    let response_topic = values[0];
    let response_list = values[1];
    topic_arn = response_topic.TopicArn;
    if (response_list.Contents.length == 0) {
      log("handleJobBatches empty")
      return [];
    }
    log(`handleJobBatches len=${response_list.Contents.length}`);
    var promise_batch_list = [];
    for (var index = 0; index < response_list.Contents.length; index++) {
      let s3_key = response_list.Contents[index].Key;
      let params_getobj = {
        Bucket: s3_bucket_name,
        Key: s3_key,
      };
      log("S3 getObject PARAMS: %s", JSON.stringify(params_getobj));
      // Grab All S3 Files, load them into JSON parsed OBJECTS
      // send them iterativly to SNS and call done with the number sent
      let promise_getobj = s3.getObject(params_getobj).promise()
        .then(handleS3Object.bind(null, s3_key, topic_arn))
        .then(deleteS3Object.bind(null, s3_key));
      //promise = process_s3_create_job_batch(user_name, topic_arn, session_id, s3_bucket_name, key);
      promise_batch_list.push(promise_getobj);
    }
    return Promise.all(promise_batch_list);
  }

  function handleSessionStart(values) {
      log(`"finalize_session_event_start(${session_id})"`);
      let params = {
          Message: `session.start.${session_id}`,
          MessageAttributes: {
            'event': {
              DataType: 'String',
              StringValue: `session.start.${session_id}`
            },
            'session': {
              DataType: 'String',
              StringValue: session_id
            },
            'username': {
              DataType: 'String',
              StringValue: user_name
            }
          },
          TopicArn: topic_arn
      };
      let promise = sns.publish(params, function(err, data) {
          if (err) {
            log(`Failure: SNS Publish Session Start(${session_id})`);
            log(err, err.stack); // an error occurred
          } else {
            log(`"Success: SNS Publish Session Start(${session_id})"`);
          }
      });
      return promise;
  };

  let params = {
    Bucket: s3_bucket_name,
    Prefix: user_name + '/session/create/' + session_id + '/',
    StartAfter: user_name + '/session/create/' + session_id + '/'
  };
  Promise.all([sns.createTopic({Name: foqus_update_topic}).promise(),
    s3.listObjectsV2(params).promise()])
    .then(handleS3ObjectList)
    .then(handleSessionStart)
    .then(handleDone)
    .catch(handleError);
};
