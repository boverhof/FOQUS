import json, os, copy
import boto3
import numpy as np
from sdoe import usf
from botocore.exceptions import ClientError

CONSUMER_ID = "00000000-0000-0000-0000-000000000000"

#
# Receives messages from a Job Queue for SDOE usf.compute_min_dist executions
#  publishes job status updates to an SNS Topic as it processes the message
#
def lambda_handler(event, context):
    #print("EVENT: %s" % (json.dumps(event)))
    sns = boto3.client("sns")
    update_topic_arn = os.environ["SDOE_BATCH_TOPIC_ARN"]
    print("SDOE compute_min_dist: TOPIC_ARN=%s" % (update_topic_arn))
    num_executions = 0
    assert "Records" in event, "Format Error: No Records in SNS Message"
    print("Number Records: %d" % (event["Records"].length))
    for record in event["Records"]:
        if "Sns" not in record:
            print("Ignore non-Sns record")
            continue
        assert "MessageId" in record, "Format Error: missing MessageId in Sns Record"
        msg_id = record["MessageId"]
        print("Start Record=%d, messageId=%s" % (num_executions,msg_id))
        body = record["body"]
        job = json.loads(body)

        application = record["MessageAttributes"]["application"]["stringValue"]
        job_id = record["messageAttributes"]["job"]["stringValue"]
        session_id = record["messageAttributes"]["session"]["stringValue"]
        username = record["messageAttributes"]["username"]["stringValue"]
        # simulation = record['messageAttributes']['simulation']['stringValue']
        assert application.startswith("sdoe")
        # assert simulation.startswith('sdoe')
        msg_attrs = dict()
        msg_attrs["application"] = dict(StringValue=application, DataType="String")
        msg_attrs["event"] = dict(StringValue="job.setup", DataType="String")
        msg_attrs["job"] = dict(StringValue=job_id, DataType="String")
        msg_attrs["session"] = dict(StringValue=session_id, DataType="String")
        msg_attrs["username"] = dict(StringValue=username, DataType="String")

        job2 = copy.deepcopy(job)
        job2["consumer"] = CONSUMER_ID
        job2["instanceid"] = "lambda"
        job2["status"] = "setup"
        params = dict(
            Message=json.dumps(job2),
            MessageAttributes=msg_attrs,
            TopicArn=update_topic_arn,
        )
        ret = sns.publish(**params)

        msg_attrs["event"]["StringValue"] = "job.running"
        job2["status"] = "running"
        params = dict(
            Message=json.dumps(job2),
            MessageAttributes=msg_attrs,
            TopicArn=update_topic_arn,
        )
        ret = sns.publish(**params)

        input = job["Input"]
        mat = input.get("mat")
        scl = input.get("scl")
        """ [[1, 1], [2, 2], [3, 3]]
            [2.0, 2.0]
        """
        try:
            mat = np.array(mat)
            scl = np.array(scl)
        except Exception as e:
            print("ERROR packing numpy arrays")
            msg_attrs["event"]["StringValue"] = "job.error"
            job2["event"] = "status"
            job2["status"] = "error"
            job2["message"] = "ERROR packing numpy arrays: %s" % (e)
            params = dict(
                Message=json.dumps(job2),
                MessageAttributes=msg_attrs,
                TopicArn=update_topic_arn,
            )
            ret = sns.publish(**params)
            return {"statusCode": 400, "body": json.dumps(dict(error=str(e)))}
        try:
            dmat, min_dist = usf.compute_min_dist(mat, scl, hist_xs=None)
            # assert np.array_equal(
            #     np.array([[10.0, 0.5, 2.0], [0.5, 10.0, 0.5], [2.0, 0.5, 10.0]]), dmat
            # )
            # assert np.array_equal(np.array([0.5, 0.5, 0.5]), min_dist)
        except Exception as e:
            print("ERROR Calling compute_min_dist")
            msg_attrs["event"]["StringValue"] = "job.error"
            job2["event"] = "status"
            job2["status"] = "error"
            job2["message"] = "ERROR Calling compute_min_dist: %s" % (e)
            params = dict(
                Message=json.dumps(job2),
                MessageAttributes=msg_attrs,
                TopicArn=update_topic_arn,
            )
            ret = sns.publish(**params)
            return {"statusCode": 400, "body": json.dumps(dict(error=str(e)))}

        msg_attrs["event"]["StringValue"] = "job.output"
        job2["event"] = "output"
        job2["value"] = json.dumps(dict(dmat=dmat.tolist(), min_dist=min_dist.tolist()))
        params = dict(
            Message=json.dumps(job2),
            MessageAttributes=msg_attrs,
            TopicArn=update_topic_arn,
        )
        ret = sns.publish(**params)
        msg_attrs["event"]["StringValue"] = "job.success"
        job2["event"] = "status"
        job2["status"] = "success"
        params = dict(
            Message=json.dumps(job2),
            MessageAttributes=msg_attrs,
            TopicArn=update_topic_arn,
        )
        ret = sns.publish(**params)
        num_executions += 1

    print("Finished: SDOE Executions %d" % (num_executions))
    return {"statusCode": 200, "body": "SDOE Executions %d" % (num_executions)}
