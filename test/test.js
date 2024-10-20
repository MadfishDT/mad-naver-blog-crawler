const BlogCrawler = require('../dist/index').BlogCrawler;

const crawler = new BlogCrawler('cozy95', 1, 30);
crawler.execute(30).then((results) => {
    //console.log(results);
});
