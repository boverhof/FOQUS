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
const assert = require('assert');
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
function finalize_session_event_start(topic_arn, session_id, user_name, callback) {
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
          callback(null, {
              statusCode: 500,
              body: JSON.stringify({
                event:`session.start.${session_id})`,
                message: "SNS publish failure"
              }),
              headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*'
              },
          });
          return;
        } else {
          log(`"Success: SNS Publish Session Start(${session_id})"`);
        }
    }).promise();
    return promise;
};

function process_s3_create_job_batch(user_name, topic_arn, session_id, s3_bucket_name, s3_key) {
  if (s3_key.endsWith('.json') == false) {
    log(`SKIP NOT JSON: key=${s3_key}`);
    return;
  }
  let params_getobj = {
    Bucket: s3_bucket_name,
    Key: s3_key,
  };
  log("S3 getObject PARAMS: %s", JSON.stringify(params_getobj));
  // Grab All S3 Files, load them into JSON parsed OBJECTS
  // send them iterativly to SNS and call done with the number sent
  let promise_getobj = s3.getObject(params_getobj).promise();
  promise_getobj
    .then(function(response_getobj) {
      let values = JSON.parse(response_getobj.Body.toString('utf-8'));
      log(`S3 getObject values(${s3_key}): ${values.length}`);
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
          }).promise();
          promise_sns_list.push(promise_sns);
      }
      log(`SNS Promise List(${s3_key}), Len=${promise_sns_list.length}`);
      return Promise.all(promise_sns_list)
        .then(function() {
          log(`Delete: bucket=${s3_bucket_name} key=${s3_key}`);
          let params_delete = {Bucket: s3_bucket_name, Delete:{Objects:[{Key:s3_key}]}};
          let promise = s3.deleteObjects(params_delete, function(err, data) {
              if (err) {
                  log(`handleDelete(${params_delete.Delete.Objects.length}), ERROR: ${err}`);
                  log(`handleDelete ERROR Stack: ${err.stack}`);
              } else {
                  log(`handleDelete: DELETED ${JSON.stringify(params_delete)}`);
              }
          }).promise();
          return promise;
        });
    });
  return promise_getobj;
};

exports.handler = function(event, context, callback) {
  log(`Running index.handler: "${event.httpMethod}"`);
  log("request: " + JSON.stringify(event));
  const done = (err, res) => callback(null, {
      statusCode: err ? '400' : '200',
      body: err ? err.message : JSON.stringify(res),
      headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
      },
  });
  if (event.requestContext == null) {
    context.fail("No requestContext for user mapping");
    return;
  }
  if (event.requestContext.authorizer == null) {
    log("API Gateway Testing");
    done(null, []);
    return;
  }

  const user_name = event.requestContext.authorizer.principalId;
  if (event.httpMethod == "POST") {
    log("PATH: " + event.path);
    const session_id = event.path.split('/')[2];
    log("SESSIONID: " + session_id);
    log("SESSION BUCKET_NAME: " + s3_bucket_name);
    let params = {
      Bucket: s3_bucket_name,
      Prefix: user_name + '/session/create/' + session_id + '/',
      StartAfter: user_name + '/session/create/' + session_id + '/'
    };
    let request_list = s3.listObjectsV2(params, function(err, data) {
        if (err) {
          log(err, err.stack); // an error occurred
          done(new Error(`"${err.stack}"`));
          return;
        }
    });
    request_list.on('success', function(response_list) {
        log("S3 listObjects Contents: length="+ response_list.data.Contents.length);
        log("Create Topic: Name=" + foqus_update_topic);
        let request_topic = sns.createTopic({
            Name: foqus_update_topic,
          }, function(err, data) {
                if (err) {
                  log("ERROR: Failed to SNS CREATE TOPIC");
                  log(err.stack);
                  done(new Error(`"${err.stack}"`));
                  return;
                }
        });
        //
        // List of files {seconds_since_epoch}.json
        // containing Array of job requests
        //
        request_topic.on('success', function(response_topic) {
            var topic_arn = response_topic.data.TopicArn;
            log("SNS Response Topic: " + topic_arn);
            // TAKE S3 LIST OBJECTS
            // Could have multiple S3 objects ( each representing single start )
            if (response_list.data.Contents.length == 0) {
              done(null, []);
              return;
            }
            let promise;
            let promise_batch_list = [];
            for (var index = 0; index < response_list.data.Contents.length; index++) {
              promise = process_s3_create_job_batch(user_name, topic_arn, session_id, s3_bucket_name, response_list.data.Contents[index].Key);
              promise_batch_list.push(promise);
            }
            Promise.all(promise_batch_list)
              .then(function() {
                log("== Finished");
                let promise_f = finalize_session_event_start(topic_arn, session_id, user_name, callback);
                promise_f
                  .then(function() {
                    log(`== Finished success(${id_list.length}): ${id_list}`);
                    done(null, id_list);
                  });
                return promise_f;
              })
              .catch(function(error) {
                log("== Finished error");
                log(error, error.stack); // an error occurred
                done(new Error(`"${error.stack}"`));
              });
        });
    });
  }
  else {
    done(new Error(`Unsupported method "${event.httpMethod}"`));
  }
  log('Waiting for promises to fufill');
};
