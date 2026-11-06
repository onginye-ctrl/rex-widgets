const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const widgetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "widgets", "chinese_catalog.js");
const expectedId = process.argv[3] || "org.catalog.chinese";
const expectedVersion = process.argv[4] || "1.0.0";
const source = fs.readFileSync(widgetPath, "utf8");
const calls = [];

const movieFixture = {
  results: [
    {
      id: 1001,
      title: "测试电影",
      original_title: "Test Movie",
      poster_path: "/poster.jpg",
      backdrop_path: "/backdrop.jpg",
      release_date: "2025-03-01",
      vote_average: 8.2,
      overview: "一部测试电影。"
    },
    {
      id: 1002,
      name: "零分条目",
      poster_path: "",
      first_air_date: "2019-01-01",
      vote_average: 0,
      overview: ""
    }
  ]
};

const searchFixture = {
  results: [
    { id: 2001, media_type: "movie", title: "搜到的电影", poster_path: "/a.jpg", vote_average: 7.1 },
    { id: 2002, media_type: "tv", name: "搜到的剧集", poster_path: "/b.jpg", first_air_date: "2024-05-01" },
    { id: 2003, media_type: "person", name: "某个演员" }
  ]
};

function installWidget() {
  global.Widget = {
    tmdb: {
      get: async (api, options = {}) => {
        calls.push({ api, params: options.params || {} });
        if (api.startsWith("discover/")) return JSON.parse(JSON.stringify(movieFixture));
        if (api === "search/multi") return JSON.parse(JSON.stringify(searchFixture));
        throw new Error("unmocked tmdb api: " + api);
      }
    }
  };
  return new Function(
    "Widget",
    "WidgetMetadata",
    source + "\nreturn { metadata: WidgetMetadata, loadList, search };"
  )(global.Widget, {});
}

async function run() {
  const { metadata, loadList, search } = installWidget();

  assert.match(source.trimStart(), /^WidgetMetadata\s*=\s*\{/);
  assert.equal(metadata.id, expectedId);
  assert.equal(metadata.version, expectedVersion);
  assert.equal(metadata.search.functionName, "search");

  const list = await loadList({ category: "movie_popular", region: "all", page: 1 });
  assert.equal(list.length, 2);
  const firstCall = calls[0];
  assert.equal(firstCall.api, "discover/movie");
  assert.equal(firstCall.params.language, "zh-CN");
  assert.equal(firstCall.params.with_original_language, "zh");
  assert.equal(firstCall.params.sort_by, "popularity.desc");
  assert.equal(firstCall.params.page, 1);
  assert.equal(firstCall.params["vote_count.gte"], undefined);

  assert.equal(list[0].id, 1001);
  assert.equal(list[0].type, "tmdb");
  assert.equal(list[0].mediaType, "movie");
  assert.equal(list[0].title, "测试电影");
  assert.equal(list[0].posterPath, "/poster.jpg", "海报应保留 TMDB 原始路径");
  assert.equal(list[0].backdropPath, "/backdrop.jpg");
  assert.equal(list[0].releaseDate, "2025-03-01");
  assert.equal(list[0].rating, 8.2);
  assert.equal(list[1].rating, undefined, "零分不应写入 rating");

  await loadList({ category: "movie_top", region: "all", page: 2 });
  const topCall = calls[calls.length - 1];
  assert.equal(topCall.params.sort_by, "vote_average.desc");
  assert.equal(topCall.params["vote_count.gte"], 200);
  assert.equal(topCall.params.page, 2);

  await loadList({ category: "movie_new", region: "CN", page: 999 });
  const cnCall = calls[calls.length - 1];
  assert.equal(cnCall.params.sort_by, "primary_release_date.desc");
  assert.equal(cnCall.params.with_origin_country, "CN");
  assert.equal(cnCall.params.page, 500, "页码应封顶 500");

  await loadList({ category: "tv_top", region: "HK", page: 0 });
  const tvCall = calls[calls.length - 1];
  assert.equal(tvCall.api, "discover/tv");
  assert.equal(tvCall.params.with_origin_country, "HK");
  assert.equal(tvCall.params["vote_count.gte"], 100);
  assert.equal(tvCall.params.page, 1);

  await loadList({});
  assert.equal(calls[calls.length - 1].api, "discover/movie", "缺省应回落到热门电影");

  const before = calls.length;
  assert.deepEqual(await search({ keyword: "   " }), []);
  assert.equal(calls.length, before, "空关键词不应发请求");

  const searched = await search({ keyword: "电影", page: 3 });
  assert.equal(searched.length, 2, "person 结果应被过滤");
  assert.deepEqual(searched.map((item) => item.mediaType), ["movie", "tv"]);
  assert.equal(searched[1].title, "搜到的剧集");
  assert.equal(searched[1].releaseDate, "2024-05-01");
  const searchCall = calls[calls.length - 1];
  assert.equal(searchCall.api, "search/multi");
  assert.equal(searchCall.params.query, "电影");
  assert.equal(searchCall.params.language, "zh-CN");
  assert.equal(searchCall.params.include_adult, false);
  assert.equal(searchCall.params.page, 3);

  console.log(`chinese catalog ok: ${list.length} list items, ${searched.length} search items, ${calls.length} tmdb calls`);
}

run().catch((error) => {
  console.error("test failed:", error);
  process.exitCode = 1;
});
