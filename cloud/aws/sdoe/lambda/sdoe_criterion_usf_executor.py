import json, os, copy
import boto3
import numpy as np
import pandas as pd
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
        application = record_sns["MessageAttributes"]["application"]["Value"]
        request_s3key = record_sns["MessageAttributes"]["request-s3key"]["Value"]
        request_s3bucket = record_sns["MessageAttributes"]["request-s3bucket"]["Value"]
        criterion_id = record_sns["MessageAttributes"]["criterion-id"]["Value"]
        candidates_length = record_sns["MessageAttributes"]["candidates-length"]["Value"]
        response_s3bucket = record_sns["MessageAttributes"]["response-s3bucket"]["Value"]
        username = record_sns["MessageAttributes"]["username"]["Value"]
        event = record_sns["MessageAttributes"]["event"]["Value"]

        assert application == "sdoe.usf.criterion"
        assert event == "submit"

        msg_attrs = dict()
        msg_attrs["application"] = dict(StringValue=application, DataType="String")
        msg_attrs["request-s3key"] = dict(StringValue=request_s3key, DataType="String")
        msg_attrs["request-s3bucket"] = dict(StringValue=request_s3bucket, DataType="String")
        msg_attrs["criterion-id"] = dict(StringValue=criterion_id, DataType="String")
        msg_attrs["candidates-length"] = dict(StringValue=candidates_length, DataType="String")
        msg_attrs["response-s3bucket"] = dict(StringValue=response_s3bucket, DataType="String")
        msg_attrs["username"] = dict(StringValue=username, DataType="String")

        print("Load Criterion and candidate List")
        config = json.loads(msg)
        include = [s.strip() for s in config["input"]["include"].split(",")]
        max_vals = [float(s) for s in config["input"]["max_vals"].split(",")]
        min_vals = [float(s) for s in config["input"]["min_vals"].split(",")]
        types = [s.strip() for s in config["input"]["types"].split(",")]
        idx = [x for x, t in zip(include, types) if t == "Input"]
        id_ = [x for x, t in zip(include, types) if t == "Index"]
        if id_:
            assert (
                len(id_) == 1
            ), "Multiple INDEX columns detected. There should only be one INDEX column."
            id_ = id_[0]
        else:
            id_ = None

        scl = np.array([ub - lb for ub, lb in zip(max_vals, min_vals)])
        args = {
            "icol": id_,
            "xcols": idx,
            "scale_factors": pd.Series(scl, index=include),
        }

        # # load candidates
        # if cfile:
        #     cand = load(cfile, index=id_)
        #     if len(include) == 1 and include[0] == "all":
        #         include = list(cand)
        cand = pd.DataFrame(config["candidates"])
        cand.columns = include[1:]
        print("RUN CRITERION ALL")
        try:
            result = usf.criterion_all(
                        cand=cand,
                        args=args,
                        nd=config["nd"],
                        mode=config["mode"],
                        hist=config["hist"]
            )
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
        print("FINISHED CRITERION ALL")
        print("KEYS: {}".format(result.keys()))
        for i in result.keys():
            print("%s -- %s" %(i,result[i]))
        assert result.get("best_cand") is not None
        # d = {"best_index":result['best_index'], 'best_value':result['best_value'],
        #     'best_dmat':result['best_dmat'].tolist(),

        d = dict()
        d['best_cand'] = result['best_cand'].to_json()
        d['best_index'] = result['best_index']
        d['best_val']= result['best_val']
        d['best_dmat']= result['best_dmat'].tolist()
        d['dmat_cols']= result['dmat_cols']
        d['mode']= result['mode']
        d['design_size']= result['design_size']
        d['num_restarts']= result['num_restarts']
        d['elapsed_time']= result['elapsed_time']
        print("OUTPUT {}".format(result))

        try:
            output = json.dumps(d)
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
