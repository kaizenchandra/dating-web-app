#!/bin/sh
set -eu
umask 077
printf '{"identities":[{"name":"profile-service","credentials":[{"accessKey":"raahi_media","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' "$S3_SECRET_KEY" > /tmp/s3.json
exec weed server -dir=/data -ip="${MEDIA_HOST:-media}" -s3 -s3.port=9000 -s3.config=/tmp/s3.json -volume.max=8 -master.volumeSizeLimitMB=1024
