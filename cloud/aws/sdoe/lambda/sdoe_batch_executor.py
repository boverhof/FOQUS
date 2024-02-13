import json, os, copy
import boto3
import numpy as np
from sdoe import usf
from botocore.exceptions import ClientError

CONSUMER_ID = "00000000-0000-0000-0000-000000000000"


def lambda_handler(event, context):
    # SLM Security Group us-east-1 sg-097636e72d37d985f
    # ec2 = boto3.client('ec2', region_name='us-east-1')
    print("EVENT: %s" % (json.dumps(event)))
    s3 = boto3.client("s3")
    sns = boto3.client("sns")
    sdoe_topic_arn = os.environ["SDOE_BATCH_TOPIC_ARN"]
    print("TOPIC_ARN: %s" % (sdoe_topic_arn))

    num_executions = 0
    assert type(event) is dict and "Records" in event, \
        "Format Error: No Records in SNS Message"
    assert type(event["Records"]) is list, \
        "Format Error: No Records List in SNS Message"

    for record in event["Records"]:
        record_sns = record["Sns"]
        if not record_sns:
            print("Ignore non-Sns Record: %s" % (json.dumps(record)))
            continue
        msg_id = record_sns["MessageId"]
        msg = record_sns["Message"]
        print("Execute MessageId %s" %(msg_id))
        execution_params = json.loads(msg)

        application = record_sns["MessageAttributes"]["application"]["Value"]
        request_s3key = record_sns["MessageAttributes"]["request-s3key"]["Value"]
        request_s3bucket = record_sns["MessageAttributes"]["request-s3bucket"]["Value"]
        batch_id = record_sns["MessageAttributes"]["batch-id"]["Value"]
        batch_index = record_sns["MessageAttributes"]["batch-index"]["Value"]
        batch_length = record_sns["MessageAttributes"]["batch-length"]["Value"]
        response_s3bucket = record_sns["MessageAttributes"]["response-s3bucket"]["Value"]
        username = record_sns["MessageAttributes"]["username"]["Value"]
        event = record_sns["MessageAttributes"]["event"]["Value"]
        assert application == "sdoe.usf.compute_min_dist"
        assert event == "submit"

        msg_attrs = dict()
        msg_attrs["application"] = dict(StringValue=application, DataType="String")
        msg_attrs["request-s3key"] = dict(StringValue=request_s3key, DataType="String")
        msg_attrs["request-s3bucket"] = dict(StringValue=request_s3bucket, DataType="String")
        msg_attrs["batch-id"] = dict(StringValue=batch_id, DataType="String")
        msg_attrs["batch-index"] = dict(StringValue=batch_index, DataType="String")
        msg_attrs["batch-length"] = dict(StringValue=batch_length, DataType="String")
        msg_attrs["response-s3bucket"] = dict(StringValue=response_s3bucket, DataType="String")
        msg_attrs["username"] = dict(StringValue=username, DataType="String")

        mat = execution_params.get("mat")
        scl = execution_params.get("scl")
        try:
            mat = np.array(mat)
            scl = np.array(scl)
        except Exception as e:
            print("ERROR packing numpy arrays")
            msg_attrs["event"] = dict(StringValue="error", DataType="String")
            params = dict(
                Message=dict(error="ERROR: packing numpy arrays",
                    exception=str(e)),
                MessageAttributes=msg_attrs,
                TopicArn=sdoe_topic_arn,
            )
            ret = sns.publish(**params)
            return {"statusCode": 400, "body": json.dumps(dict(error=str(e)))}

        try:
            dmat, min_dist = usf.compute_min_dist(mat, scl, hist_xs=None)
        except Exception as e:
            print("ERROR: during execution of compute_min_dist")
            msg_attrs["event"] = dict(StringValue="error", DataType="String")
            #msg_attrs["event"]["StringValue"] = "job.error"
            params = dict(
                Message=dict(error="ERROR: during execution of compute_min_dist",
                    exception=str(e)),
                MessageAttributes=msg_attrs,
                TopicArn=sdoe_topic_arn,
            )
            ret = sns.publish(**params)
            return {"statusCode": 400, "body": json.dumps(dict(error=str(e)))}

        output = None
        try:
            output = json.dumps(dict(dmat=dmat.tolist(), min_dist=min_dist.tolist()))
        except Exception as e:
            print("ERROR: during output formatting of compute_min_dist")
            msg_attrs["event"] = dict(StringValue="error", DataType="String")
            #msg_attrs["event"]["StringValue"] = "job.error"
            params = dict(
                Message=dict(error="ERROR: during output formatting of compute_min_dist",
                    exception=str(e)),
                MessageAttributes=msg_attrs,
                TopicArn=sdoe_topic_arn,
            )
            ret = sns.publish(**params)
            return {"statusCode": 400, "body": json.dumps(dict(error=str(e)))}

        msg_attrs["event"] = dict(StringValue="success", DataType="String")
        params = dict(
            Message=json.dumps(output),
            MessageAttributes=msg_attrs,
            TopicArn=sdoe_topic_arn,
        )
        ret = sns.publish(**params)
        num_executions += 1

    print("Finished: SDOE Executions %d" % (num_executions))
    return {"statusCode": 200, "body": "SDOE Executions %d" % (num_executions)}


def test_handler(event, context):
    # SLM Security Group us-east-1 sg-097636e72d37d985f
    # ec2 = boto3.client('ec2', region_name='us-east-1')
    s3 = boto3.client("s3")
    sqs = boto3.client("sqs")
    try:
        print("START")
        rsp = s3.list_buckets()
        buckets = map(lambda i: i["Name"], rsp["Buckets"])
        print("RESPONSE: %s", str(list(buckets)))
    except ClientError as e:
        print(e)
        return {"statusCode": 200, "body": json.dumps("Hello from Lambda!")}
    return {"statusCode": 200, "body": json.dumps("Hello from Lambda!")}
