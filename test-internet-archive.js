const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const widgetPath = path.join(__dirname, "widgets", "internet_archive.js");
const source = fs.readFileSync(widgetPath, "utf8");
const live = process.argv.includes("--live");
const calls = [];

const searchFixture = {
  response: {
    docs: [
      {
        identifier: "Open_Film_One",
        title: "Open Film One",
        description: "<p>An openly licensed film.</p>",
        date: "1936-01-02T00:00:00Z",
        creator: "Alice Example",
        subject: ["Animation", "Feature films"],
        licenseurl: "https://creativecommons.org/licenses/by/4.0/",
        downloads: 1000
      },
      {
        identifier: "public-domain-film",
        title: "Public Domain Film",
        rights: "Public Domain",
        year: "1928",
        subject: "Silent film"
      },
      {
        identifier: "legacy-public-domain-film",
        title: "Legacy Public Domain Film",
        licenseurl: "http://creativecommons.org/licenses/publicdomain/",
        year: "1935"
      },
      {
        identifier: "closed-film",
        title: "Closed Film",
        rights: "All rights reserved"
      }
    ]
  }
};

const openMetadata = {
  metadata: {
    identifier: "Open_Film_One",
    mediatype: "movies",
    title: "Open Film One",
    description: "<p>A film &amp; test.</p>",
    date: "1936-01-02T00:00:00Z",
    creator: ["Alice Example", "Bob Example"],
    subject: ["Animation", "Feature films", "Animation"],
    licenseurl: "https://creativecommons.org/licenses/by/4.0/"
  },
  files: [
    {
      name: "private-master.mp4",
      format: "h.264",
      source: "original",
      private: "true",
      width: "3840",
      height: "2160",
      size: "9000000000"
    },
    {
      name: "Film & More.mp4",
      format: "h.264",
      source: "original",
      width: "1920",
      height: "1080",
      size: "1500000000"
    },
    {
      name: "Open_Film_One_512kb.mp4",
      format: "512Kb MPEG4",
      source: "derivative",
      width: "640",
      height: "360",
      size: "120000000"
    },
    {
      name: "Open_Film_One_trailer.mp4",
      format: "MPEG4",
      source: "derivative",
      width: "1280",
      height: "720"
    },
    { name: "poster image.jpg", format: "JPEG", size: "5000000" },
    { name: "film_thumb.jpg", format: "JPEG", size: "100000" }
  ]
};

const restrictedMetadata = {
  metadata: {
    identifier: "restricted-film",
    mediatype: "movies",
    title: "Restricted Film",
    licenseurl: "https://creativecommons.org/licenses/by/4.0/",
    "access-restricted-item": "true"
  },
  files: [{ name: "restricted.mp4", format: "MPEG4" }]
};

const unlicensedMetadata = {
  metadata: {
    identifier: "unlicensed-film",
    mediatype: "movies",
    title: "Unlicensed Film",
    rights: "All rights reserved"
  },
  files: [{ name: "unlicensed.mp4", format: "MPEG4" }]
};

function evaluateWidget() {
  return new Function(
    "Widget",
    "WidgetMetadata",
    source + "\nreturn { metadata: WidgetMetadata, loadList, search, loadDetail, loadResource };"
  )(global.Widget, {});
}

function installOfflineWidget() {
  global.Widget = {
    http: {
      get: async (url, options = {}) => {
        calls.push({ url, options });
        if (url.startsWith("https://archive.org/advancedsearch.php")) {
          return { data: JSON.parse(JSON.stringify(searchFixture)) };
        }
        const prefix = "https://archive.org/metadata/";
        if (url.startsWith(prefix)) {
          const id = decodeURIComponent(url.slice(prefix.length));
          if (id === "Open_Film_One") return { data: JSON.parse(JSON.stringify(openMetadata)) };
          if (id === "restricted-film") return { data: restrictedMetadata };
          if (id === "unlicensed-film") return { data: unlicensedMetadata };
          throw new Error("unmocked identifier: " + id);
        }
        throw new Error("unmocked URL: " + url);
      }
    }
  };
  return evaluateWidget();
}

function installLiveWidget() {
  global.Widget = {
    http: {
      get: async (url, options = {}) => {
        calls.push({ url, options });
        const { stdout } = await execFileAsync(
          "curl",
          ["-4", "--silent", "--show-error", "--location", "--fail-with-body", "--max-time", "45", url],
          { maxBuffer: 16 * 1024 * 1024 }
        );
        return { data: JSON.parse(stdout), status: 200 };
      }
    }
  };
  return evaluateWidget();
}

async function probeRange(url) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-4",
      "--silent",
      "--show-error",
      "--location",
      "--fail-with-body",
      "--max-time",
      "45",
      "--range",
      "0-0",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}\\n%{content_type}",
      url
    ],
    { maxBuffer: 1024 * 1024 }
  );
  const lines = stdout.trim().split("\n");
  return { status: Number(lines[0]), contentType: lines.slice(1).join("\n") };
}

async function runOffline() {
  const { metadata, loadList, search, loadDetail, loadResource } = installOfflineWidget();

  assert.match(source.trimStart(), /^WidgetMetadata\s*=\s*\{/);
  assert.equal(metadata.id, "org.archive.openmovies");
  assert.equal(metadata.search.functionName, "search");
  assert.equal(metadata.modules.some((module) => module.id === "loadResource"), false, "稳定 MP4 直链不应被动态资源模块拦截");

  const list = await loadList({
    category: "animation",
    sort: "oldest",
    page: 2,
    count: 999,
    genreId: "Feature films",
    peopleId: "Alice Example"
  });
  assert.equal(list.length, 3, "列表应保留现代、rights 与旧版公版许可，并过滤未开放条目");
  assert.deepEqual(
    list.map((item) => item.id),
    ["ia:Open_Film_One", "ia:public-domain-film", "ia:legacy-public-domain-film"]
  );
  assert.match(list[2].description, /许可：Public Domain/);
  assert.equal(list[0].type, "url");
  assert.equal(list[0].mediaType, "movie");
  assert.equal(list[0].link, list[0].id);
  assert.equal(list[0].coverUrl, "https://archive.org/services/img/Open_Film_One");
  assert.equal(list[0].releaseDate, "1936-01-02");
  assert.match(list[0].description, /许可：CC BY 4\.0/);
  assert.equal(list[0].licenseurl, undefined, "原始接口字段不应泄漏到 VideoItem");

  const listRequest = calls[0];
  const listUrl = new URL(listRequest.url);
  assert.equal(listUrl.origin + listUrl.pathname, "https://archive.org/advancedsearch.php");
  assert.equal(listRequest.options.params, undefined, "查询参数应直接拼进 URL，避免不同客户端的序列化差异");
  assert.equal(/\s/.test(listRequest.url), false, "URL 中不应出现未编码的空格");
  assert.equal(listUrl.searchParams.get("page"), "2");
  assert.equal(listUrl.searchParams.get("rows"), "50", "每页数量应限制在 50");
  assert.equal(listUrl.searchParams.get("fl"), "identifier,title,description,date,year,creator,subject,licenseurl,rights,downloads,publicdate");
  assert.equal(listUrl.searchParams.get("sort"), "date asc");
  assert.equal(listUrl.searchParams.has("fl[]"), false, "请求参数键不应包含方括号");
  assert.equal(listUrl.searchParams.has("sort[]"), false, "请求参数键不应包含方括号");
  assert.match(listUrl.searchParams.get("q"), /mediatype:movies/);
  assert.match(listUrl.searchParams.get("q"), /subject:animation/);
  assert.match(listUrl.searchParams.get("q"), /subject:"Feature films"/);
  assert.match(listUrl.searchParams.get("q"), /creator:"Alice Example"/);

  const beforeBlankSearch = calls.length;
  assert.deepEqual(await search({ keyword: "   " }), []);
  assert.equal(calls.length, beforeBlankSearch, "空搜索不应发请求");

  const searched = await search({ keyword: "film \"one\"", page: 3, count: 7 });
  assert.equal(searched.length, 3);
  const searchRequest = calls[calls.length - 1];
  const searchUrl = new URL(searchRequest.url);
  assert.equal(/\s/.test(searchRequest.url), false, "URL 中不应出现未编码的空格");
  assert.equal(searchUrl.searchParams.get("page"), "3");
  assert.equal(searchUrl.searchParams.get("rows"), "7");
  assert.match(searchUrl.searchParams.get("q"), /title:/);
  assert.match(searchUrl.searchParams.get("q"), /film \\"one\\"/);

  const beforeInvalid = calls.length;
  assert.equal(await loadDetail("https://archive.org/details/Open_Film_One"), null);
  assert.equal(await loadDetail("ia:../Open_Film_One"), null);
  assert.deepEqual(await loadResource({ id: "550" }), []);
  assert.deepEqual(await loadResource({ link: "other:Open_Film_One", id: "ia:Open_Film_One" }), []);
  assert.equal(calls.length, beforeInvalid, "非法来源标识不得触发网络请求");

  const detail = await loadDetail("ia:Open_Film_One");
  assert.ok(detail);
  assert.equal(detail.id, "ia:Open_Film_One");
  assert.equal(detail.link, detail.id);
  assert.equal(detail.videoUrl, "https://archive.org/download/Open_Film_One/Film%20%26%20More.mp4");
  assert.equal(detail.playerType, "system");
  assert.match(detail.description, /A film & test\./);
  assert.match(detail.description, /许可：CC BY 4\.0/);
  assert.deepEqual(detail.genreItems[0], { id: "Animation", title: "Animation" });
  assert.equal(detail.genreItems.length, 2, "重复主题应去重");
  assert.deepEqual(detail.peoples[0], { id: "Alice Example", title: "Alice Example", role: "创作者" });
  assert.ok(Array.isArray(detail.backdropPaths));
  assert.ok(detail.backdropPaths.includes("https://archive.org/download/Open_Film_One/poster%20image.jpg"));
  assert.equal(detail.stills, undefined);
  assert.equal(detail.recommendations, undefined);

  const resources = await loadResource({ link: "ia:Open_Film_One" });
  assert.equal(resources.length, 2, "私有、预告和非 MP4 文件应排除");
  assert.equal(resources[0].url, detail.videoUrl, "最佳 MP4 应与详情直链一致");
  assert.match(resources[0].name, /1080p/);
  assert.match(resources[0].description, /1920×1080/);
  assert.equal(resources[0].playerType, "system");
  assert.equal(resources[0].customHeaders, undefined);

  assert.equal(await loadDetail("ia:restricted-film"), null);
  assert.deepEqual(await loadResource({ link: "ia:restricted-film" }), []);
  assert.equal(await loadDetail("ia:unlicensed-film"), null);
  assert.deepEqual(await loadResource({ link: "ia:unlicensed-film" }), []);

  const metadataCalls = calls.filter((call) => call.url.startsWith("https://archive.org/metadata/"));
  assert.ok(metadataCalls.some((call) => call.url.endsWith("Open_Film_One")));
  assert.ok(metadataCalls.some((call) => call.url.endsWith("restricted-film")));
  console.log(`offline ok: ${list.length} list items, ${resources.length} MP4 resources, ${calls.length} mocked requests`);
}

async function runLive() {
  const { loadList, search, loadDetail } = installLiveWidget();

  const list = await loadList({ page: 1, count: 5, sort: "popular", category: "all" });
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0, "真实搜索应返回至少一个开放许可条目");
  list.forEach((item) => {
    assert.equal(item.type, "url");
    assert.match(item.link, /^ia:[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  const searched = await search({ keyword: "Big Buck Bunny", page: 1, count: 5 });
  assert.ok(searched.some((item) => item.link === "ia:BigBuckBunny_328"), "真实搜索应命中 BigBuckBunny_328");

  const detail = await loadDetail("ia:BigBuckBunny_328");
  assert.ok(detail, "BigBuckBunny_328 应通过开放许可与公开 MP4 校验");
  assert.match(detail.description, /CC BY/i);
  assert.match(detail.videoUrl, /^https:\/\/archive\.org\/download\/BigBuckBunny_328\//);

  const probe = await probeRange(detail.videoUrl);
  assert.equal(probe.status, 206, `MP4 Range 探测返回 ${probe.status}`);
  assert.match(probe.contentType, /video|mp4|octet-stream/i);

  console.log(`live ok: ${list.length} list items, direct MP4 probe ${probe.status} ${probe.contentType}`);
}

(live ? runLive() : runOffline()).catch((error) => {
  console.error("test failed:", error);
  process.exitCode = 1;
});
