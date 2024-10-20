import axios from 'axios';
import * as qs from 'qs';
import { parse, format } from 'url';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import * as path from 'path';
import * as fs from 'fs';

dayjs.extend(utc);
dayjs.extend(timezone);

const NAVER_POST_VIEWURL = 'https://blog.naver.com/PostView.naver'

export interface BlogArchive {
    id: string;
    title: string;
    link: string;
    date: string;
    image?: string | null;
}

function getBlogCategoryPageUrl(blogId: string, categoryNo?: number, pageNo: number = 1, countPerPage: number = 30) {
    return `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=${pageNo}&categoryNo=${categoryNo}&parentCategoryNo=&countPerPage=${countPerPage}`;
}

export class BlogCrawler {
    private blogId: string;
    private countPerPage: number;
    private categoryNumber: number | undefined;


    constructor(blogId: string, categoryNumber: number, countPerPage: number) {
        this.blogId = blogId;
        this.countPerPage = countPerPage;
        this.categoryNumber = categoryNumber;
    }

    private createUrl(blogId: string, logNo: string, parentCategoryNo: string): string {
        const baseUrl = NAVER_POST_VIEWURL;
        const params = {
            blogId,
            logNo,
            parentCategoryNo,
            viewDate: '',
            currentPage: '1',
            postListTopCurrentPage: '',
            from: 'postList',
            userTopListOpen: 'true',
            userTopListCount: this.countPerPage.toString(),
            userTopListManageOpen: 'false',
            userTopListCurrentPage: '1'
        };
        return `${baseUrl}?${qs.stringify(params)}`;
    }

    /**
     * @param pageNumber : blog post list page counter
     * @returns : Array<[title, blogUrl, formattedDate]> 
     */
    public async getLatestBlogUrls(pageNumber: number): Promise<Array<[string, string, string | null]>> {
        const urlArray: Array<[string, string, string | null]> = [];
        const url = getBlogCategoryPageUrl(this.blogId, this.categoryNumber, pageNumber, this.countPerPage);

        const response = await axios.get(url);
        //get post data
        const safeString = response.data.replace(/'/g, "\\'");
        const data = JSON.parse(safeString);

        for (const post of data.postList) {
            const logNo = post.logNo;
            const title = decodeURIComponent(post.title);
            const parentCategoryNo = post.parentCategoryNo || '';
            const blogUrl = this.createUrl(this.blogId, logNo, parentCategoryNo);
            let formattedDate: string | null = null;
            const addDate = post.addDate || '';
            if (addDate) {
                try {
                    formattedDate = dayjs(addDate, 'YYYY. MM. DD.').format('YYYYMMDD');
                } catch {
                    formattedDate = dayjs().format('YYYYMMDD');
                }
            }
            urlArray.push([title, blogUrl, formattedDate]);
        }
        return urlArray;
    }

    private async getPostFilesFromBlogUrl(url: string): Promise<string | null> {
        const response = await axios.get(url);
        console.log(url);
        const match = response.data.match(/data-lazy-src="(https:\/\/postfiles\.pstatic\.net\/[^"]+)"/);
        console.log(match);
        return match ? match[1] : null;
    }

    private extractBlogIdLogNo(url: string): string {
        const parsedUrl = parse(url, true);
        const blogId = (parsedUrl.query.blogId as string) || '';
        const logNo = (parsedUrl.query.logNo as string) || '';
        return blogId + logNo;
    }

    private createDatetimeKrNoon(dateStr: string): string {
        return dayjs.tz(`${dateStr} 12:00:00`, 'Asia/Seoul').toISOString();
    }

    public async downloadImage(imageUrl: string): Promise<Buffer> {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        return Buffer.from(response.data, 'binary');
    }

    public async execute(pageCounts: number = 30): Promise<BlogArchive[]> {
        const urlList = await this.getLatestBlogUrls(pageCounts);
        const results: Array<BlogArchive> = [];

        for (const [title, url, date] of urlList) {
            const imageUrl = await this.getPostFilesFromBlogUrl(url);
            const id = this.extractBlogIdLogNo(url);
            const archive = {
                id,
                title,
                link: url,
                date: this.createDatetimeKrNoon(date || ''),
                image: imageUrl
            };
            results.push(archive);
        }


        /* if (results.length > 0) {
             for (const archive of results) {
                 const imageBytes = await this.downloadImage(archive.image);
                 const fileName = `${archive.id}${this.getFileExtFromUrl(archive.image)}`;
                 await this.uploadImageToGCS(imageBytes, 'your-bucket-name', fileName);
             }
         }*/
        return results;
    }
}

export default BlogCrawler;
