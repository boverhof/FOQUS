/**
 * Pops job off SQS Job queue and sends canned notifications to SNS Update Topic
 * which will cause foqus-sns-update to create job updates.
 *
 * @module foqus-fake-job-runner
 * @author Joshua Boverhof <jrboverhof@lbl.gov>
 * @version 1.0
 * @license See LICENSE.md
 * @see https://github.com/motdotla/node-lambda-template
 */
'use strict';
const AWS = require('aws-sdk');
const sqs = new AWS.SQS();
const sns = new AWS.SNS();
const queue_name = process.env.FOQUS_JOB_QUEUE;
const update_topic_arn = process.env.FOQUS_UPDATE_TOPIC_ARN;
//const log = require("debug")("foqus-fake-job-runner")

console.log('foqus-fake-job-runner loading running');

/*
 * {\"Initialize\":false,\"Input\":{},\"Reset\":false,\"Simulation\":\"OUU\",
 * \"Visible\":false,\"Id\":\"0c8d3e01-030c-45e4-b579-c3f5dad026a0\",
 * \"resource\":\"job\",\"status\":\"submit\",
 * \"jobid\":\"0c8d3e01-030c-45e4-b579-c3f5dad026a0\",
 * \"sessionid\":\"80a19bc7-728e-45cd-bddd-331420955cfa\",\"event\":\"status\"}
 */

// d = dict(
//      resource="job",
//      event="status",
//      rc=rc,
//      status=status,
//      jobid=job_d["Id"],
//      instanceid=_instanceid,
//      consumer=self.consumer_id,
//      sessionid=job_d.get("sessionid", "unknown"),
//  )
//  if message:
//      d["message"] = message

exports.handler = async (event) => {
    let promises = [];
    console.log(JSON.stringify(event));
    for (const { Sns } of event.Records) {
        var messageId = Sns.MessageId;
        var body = Sns.Message;
        console.log('SQS message %s: %j', messageId, body);
        var job = JSON.parse(body);
        console.log('job running: %j', job);
        if (job.resource != "job") {
          console.log(`"ignore message: resource=${job.resource} ${messageId}"`);
          continue;
        }
        if (job.status != "running") {
          console.log(`"ignore message: status=${job.status} messageid=${messageId}"`);
          continue;
        }

        // SEND OUTPUT
        console.log('Sending Job Output');
        // MOVE JOB running -> success
        var job_output = JSON.parse("{}");
        job_output.resource = "job";
        job_output.event = "output";
        job_output.status = "success";
        job_output.jobid = job.jobid;
        job_output.instanceid = job.instanceid;
        job_output.consumer = job.consumer;
        job_output.sessionid = job.sessionid;
        job_output.value = JSON.stringify(["Lambda Fake Test Runner"]);
        var params = {
          Message: JSON.stringify(job_output),
          MessageAttributes: {
            'event': {
              DataType: 'String',
              StringValue: "job.output"
            },
            'username': {
              DataType: 'String',
              StringValue: "boverhof"
            }
          },
          TopicArn: update_topic_arn
        };

        var promise = sns.publish(params).promise();

        // MOVE JOB running -> success
        console.log('Sending Job Success');
        var job_finish = JSON.parse("{}");
        job_finish.resource = "job";
        job_finish.event = "status";
        job_finish.status = "success";
        job_finish.jobid = job.jobid;
        job_finish.instanceid = job.instanceid;
        job_finish.consumer = job.consumer;
        job_finish.sessionid = job.sessionid;

        job_finish.Initialize = job.Initialize;
        job_finish.Input = job.Input;
        job_finish.Reset = job.Reset;
        job_finish.Simulation = job.Simulation;
        job_finish.Visible = job.Visible;

        params = {
          Message: JSON.stringify(job_finish),
          MessageAttributes: {
            'event': {
              DataType: 'String',
              StringValue: "job.success"
            },
            'username': {
              DataType: 'String',
              StringValue: "boverhof"
            },
            'application': {
              DataType: 'String',
              StringValue: "fake-job"
            }
          },
          TopicArn: update_topic_arn
        };
        promise.then(sns.publish(params).promise());
        promises.push(promise);
    }
    return Promise.all(promises);
};
