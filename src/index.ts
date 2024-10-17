import axios from 'axios';
import * as qs from 'qs';
import { parse, format } from 'url';
import { google } from 'googleapis';
import { Storage } from '@google-cloud/storage';
import * as base64 from 'base64-js';
import * as crypto from 'crypto';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import * as path from 'path';
import { IncomingHttpHeaders } from 'http';

dayjs.extend(utc);
dayjs.extend(timezone);

function createUrl(blogId: string, logNo: string, parentCategoryNo: string) {
    const baseUrl = 'https://blog.naver.com/PostView.naver';
    const params = {
        blogId,
        logNo,
        parentCategoryNo,
        viewDate: '',
        currentPage: '1',
        postListTopCurrentPage: '',
        from: 'postList',
        userTopListOpen: 'true',
        userTopListCount: '30',
        userTopListManageOpen: 'false',
        userTopListCurrentPage: '1'
    };
    return `${baseUrl}?${qs.stringify(params)}`;
}

async function getLatest30BlogUrls(pageNo: number = 1) {
    const urlArray: Array<[string, string, string | null]> = [];
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=rsv-club&viewdate=&currentPage=${pageNo}&categoryNo=6&parentCategoryNo=&countPerPage=30`;

    const response = await axios.get(url);
    const data = JSON.parse(response.data.replace('\\', ''));

    const blogId = data.blog.blogId;
    for (const post of data.postList) {
        const logNo = post.logNo;
        const title = decodeURIComponent(post.title);
        const parentCategoryNo = post.parentCategoryNo || '';
        const url = createUrl(blogId, logNo, parentCategoryNo);
        let formattedDate = null;
        const addDate = post.addDate || '';
        if (addDate) {
            try {
                formattedDate = dayjs(addDate, 'YYYY. MM. DD.').format(
                    'YYYYMMDD'
                );
            } catch {
                formattedDate = dayjs().format('YYYYMMDD');
            }
        }
        urlArray.push([title, url, formattedDate]);
    }
    return urlArray;
}

async function getPostFilesFromBlogUrl(url: string): Promise<string | null> {
    const response = await axios.get(url);
    const match = response.data.match(
        /data-lazy-src="(https:\/\/postfiles\.pstatic\.net\/[^"]+)"/
    );
    return match ? match[1] : null;
}

function extractBlogIdLogNo(url: string): string {
    const parsedUrl = parse(url, true);
    const blogId = (parsedUrl.query.blogId as string) || '';
    const logNo = (parsedUrl.query.logNo as string) || '';
    return blogId + logNo;
}

function createDatetimeKrNoon(dateStr: string) {
    return dayjs.tz(`${dateStr} 12:00:00`, 'Asia/Seoul').toISOString();
}

async function downloadImage(imageUrl: string): Promise<Buffer> {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
}

async function uploadImageToGCS(
    imageBytes: Buffer,
    bucketName: string,
    destinationBlobName: string,
    storageClient: Storage
) {
    try {
        const bucket = storageClient.bucket(bucketName);
        const file = bucket.file(destinationBlobName);
        await file.save(imageBytes, {
            metadata: {
                contentType: 'image/jpeg'
            }
        });
        await file.makePublic();
        return file.publicUrl();
    } catch (error) {
        console.error('Error uploading image to GCS:', error);
        return null;
    }
}

function getFileExtFromUrl(url: string): string {
    const parsedUrl = parse(url);
    return path.extname(parsedUrl.pathname || '');
}

async function execute(event: any, context: any) {
    const API_HOST = process.env.API_HOST || '';
    const API_KEY = process.env.API_KEY || '';

    const storageProjectId = process.env.GOOGLE_STORAGE_PROJECT_ID || '';
    const storageEmail = process.env.GOOGLE_STORAGE_EMAIL || '';
    const storagePrivateKey = process.env.GOOGLE_STORAGE_PRIVATE_KEY
        ? process.env.GOOGLE_STORAGE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : '';

    const storage = new Storage({
        projectId: storageProjectId,
        credentials: {
            client_email: storageEmail,
            private_key: storagePrivateKey
        }
    });

    let pubsubMessage = null;
    if (event && event.data) {
        pubsubMessage = Buffer.from(event.data, 'base64').toString('utf-8');
    }

    const urlList =
        pubsubMessage && parseInt(pubsubMessage)
            ? await getLatest30BlogUrls(parseInt(pubsubMessage))
            : await getLatest30BlogUrls(2);

    const results: Array<any> = [];

    for (const [title, url, date] of urlList) {
        const imageUrl = await getPostFilesFromBlogUrl(url);
        const id = extractBlogIdLogNo(url);
        if (imageUrl) {
            const archive = {
                id,
                title,
                link: url,
                date: createDatetimeKrNoon(date || ''),
                image: imageUrl
            };
            results.push(archive);
        }
    }

    if (results.length > 0) {
        for (const archive of results) {
            const imageBytes = await downloadImage(archive.image);
            const fileName = `${archive.id}${getFileExtFromUrl(archive.image)}`;
            const imageUrl = await uploadImageToGCS(
                imageBytes,
                process.env.GOOGLE_STORAGE_BUCKET || '',
                `archives/${fileName}`,
                storage
            );
            if (imageUrl) archive.image = imageUrl;
        }

        try {
            const response = await axios.post(
                `${API_HOST}/auth/archive/super/blog`,
                results,
                {
                    headers: { key: API_KEY }
                }
            );
            console.log(response.data, response.status);
        } catch (error) {
            console.error(error);
        }
    }
}
