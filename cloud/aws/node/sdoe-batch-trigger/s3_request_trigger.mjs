/**
 * Name: s3_request_trigger
 * Description:  Triggered when a request JSON file is created in bucket
 *
 * @module s3_request_trigger
 * @author Joshua Boverhof <jrboverhof@lbl.gov>
 * @version 1.0
 * @license See LICENSE.md
 */

import { HeadObjectCommand, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({});

export const handler = async (event, context) => {
    // Get the object from the event and show its content type
    const bucket = event.Records[0].s3.bucket.name;
    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
    const params = {
        Bucket: bucket,
        Key: key,
    };
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
    return 1;
};
