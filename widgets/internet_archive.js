WidgetMetadata = {
  id: "org.archive.openmovies",
  title: "Internet Archive 开放影片",
  version: "1.0.1",
  requiredVersion: "0.0.1",
  description: "浏览和播放 Internet Archive 中明确标注为 Creative Commons 或公版、且提供公开 MP4 下载的影片。",
  author: "Cashbox",
  site: "https://archive.org",
  detailCacheDuration: 3600,
  modules: [
    {
      id: "catalog",
      title: "开放影片",
      functionName: "loadList",
      cacheDuration: 900,
      requiresWebView: false,
      sectionMode: false,
      params: [
        {
          name: "category",
          title: "分类",
          type: "enumeration",
          value: "all",
          enumOptions: [
            { title: "全部", value: "all" },
            { title: "长片", value: "feature" },
            { title: "动画", value: "animation" },
            { title: "纪录片", value: "documentary" },
            { title: "短片", value: "shorts" }
          ]
        },
        {
          name: "sort",
          title: "排序",
          type: "enumeration",
          value: "popular",
          enumOptions: [
            { title: "热门", value: "popular" },
            { title: "最新收录", value: "newest" },
            { title: "年代最早", value: "oldest" },
            { title: "标题", value: "title" }
          ]
        },
        { name: "page", title: "页码", type: "page" },
        { name: "count", title: "每页数量", type: "count", value: "20" }
      ]
    }
  ],
  search: {
    title: "搜索开放影片",
    functionName: "search",
    params: [
      { name: "keyword", title: "关键词", type: "input" },
      { name: "page", title: "页码", type: "page" },
      { name: "count", title: "每页数量", type: "count", value: "20" }
    ]
  }
};

var IA_SEARCH_URL = "https://archive.org/advancedsearch.php";
var IA_METADATA_URL = "https://archive.org/metadata/";
var IA_DOWNLOAD_URL = "https://archive.org/download/";
var IA_IMAGE_URL = "https://archive.org/services/img/";
var IA_BASE_QUERY = "mediatype:movies AND (licenseurl:* OR rights:\"Public Domain\") AND (format:\"MPEG4\" OR format:\"512Kb MPEG4\" OR format:\"h.264\") AND -access-restricted-item:true";
var IA_FIELDS = [
  "identifier",
  "title",
  "description",
  "date",
  "year",
  "creator",
  "subject",
  "licenseurl",
  "rights",
  "downloads",
  "publicdate"
];
var IA_CATEGORY_QUERIES = {
  all: "",
  feature: "subject:\"Feature films\"",
  animation: "(subject:animation OR subject:animated)",
  documentary: "subject:documentary",
  shorts: "(subject:\"Short films\" OR subject:short)"
};
var IA_SORTS = {
  popular: "downloads desc",
  newest: "publicdate desc",
  oldest: "date asc",
  title: "titleSorter asc"
};

async function loadList(params) {
  try {
    params = params || {};
    var queryParts = [IA_BASE_QUERY];
    var category = IA_CATEGORY_QUERIES[String(params.category || "all")] || "";
    if (category) queryParts.push(category);
    if (params.genreId) queryParts.push("subject:\"" + escapeArchivePhrase(params.genreId) + "\"");
    if (params.peopleId) queryParts.push("creator:\"" + escapeArchivePhrase(params.peopleId) + "\"");

    var docs = await requestArchiveSearch(
      queryParts.map(wrapQueryPart).join(" AND "),
      normalizePage(params.page),
      normalizeCount(params.count),
      IA_SORTS[String(params.sort || "popular")] || IA_SORTS.popular
    );
    return docs.filter(hasAllowedLicense).map(mapSearchDocument);
  } catch (error) {
    console.error("[internet_archive.loadList] 失败:", error && error.message ? error.message : error);
    throw error;
  }
}

async function search(params) {
  try {
    params = params || {};
    var keyword = stringValue(params.keyword).trim();
    if (!keyword) return [];

    var phrase = escapeArchivePhrase(keyword);
    var keywordQuery = "(title:\"" + phrase + "\" OR description:\"" + phrase + "\" OR creator:\"" + phrase + "\" OR subject:\"" + phrase + "\")";
    var docs = await requestArchiveSearch(
      wrapQueryPart(IA_BASE_QUERY) + " AND " + keywordQuery,
      normalizePage(params.page),
      normalizeCount(params.count),
      "_score desc"
    );
    return docs.filter(hasAllowedLicense).map(mapSearchDocument);
  } catch (error) {
    console.error("[internet_archive.search] 失败:", error && error.message ? error.message : error);
    throw error;
  }
}

async function loadDetail(link) {
  try {
    var identifier = parseOwnedLink(link);
    if (!identifier) return null;

    var item = await requestArchiveMetadata(identifier);
    if (!isPlayableOpenMovie(item)) return null;

    var files = selectPublicMp4Files(item.files);
    if (!files.length) return null;

    var metadata = item.metadata || {};
    var ownedLink = makeOwnedLink(identifier);
    var coverUrl = makeImageUrl(identifier);
    var subjects = uniqueStrings(metadata.subject).slice(0, 12);
    var creators = uniqueStrings(metadata.creator).slice(0, 8);
    var license = getLicenseInfo(metadata);
    var description = cleanText(metadata.description);
    var licenseText = license ? "许可：" + license.label : "";
    if (licenseText) description = description ? description + "\n\n" + licenseText : licenseText;

    return {
      id: ownedLink,
      type: "url",
      mediaType: "movie",
      title: cleanText(metadata.title) || identifier,
      link: ownedLink,
      coverUrl: coverUrl,
      posterPath: coverUrl,
      detailPoster: coverUrl,
      backdropPath: coverUrl,
      backdropPaths: collectBackdropUrls(identifier, item.files, coverUrl),
      releaseDate: normalizeDate(metadata.date || metadata.publicdate || metadata.year),
      description: description,
      genreTitle: subjects.slice(0, 5).join(" / "),
      genreItems: subjects.map(function (subject) {
        return { id: subject, title: subject };
      }),
      peoples: creators.map(function (creator) {
        return { id: creator, title: creator, role: "创作者" };
      }),
      videoUrl: makeDownloadUrl(identifier, files[0].name),
      playerType: "system"
    };
  } catch (error) {
    console.error("[internet_archive.loadDetail] 失败:", error && error.message ? error.message : error);
    throw error;
  }
}

async function loadResource(params) {
  try {
    params = params || {};
    var raw = params.link != null ? params.link : params.id;
    var identifier = parseOwnedLink(raw);
    if (!identifier) return [];

    var item = await requestArchiveMetadata(identifier);
    if (!isPlayableOpenMovie(item)) return [];

    return selectPublicMp4Files(item.files).map(function (file, index) {
      return {
        name: resourceName(file, index),
        description: resourceDescription(file),
        url: makeDownloadUrl(identifier, file.name),
        playerType: "system"
      };
    });
  } catch (error) {
    console.error("[internet_archive.loadResource] 失败:", error && error.message ? error.message : error);
    throw error;
  }
}

async function requestArchiveSearch(query, page, count, sort) {
  var queryParams = [
    "q=" + encodeURIComponent(query),
    "fl=" + encodeURIComponent(IA_FIELDS.join(",")),
    "rows=" + encodeURIComponent(String(count)),
    "page=" + encodeURIComponent(String(page)),
    "output=json"
  ];
  if (sort) queryParams.push("sort=" + encodeURIComponent(sort));

  var response = await Widget.http.get(IA_SEARCH_URL + "?" + queryParams.join("&"));
  var data = parseResponseData(response);
  if (!data || !data.response || !Array.isArray(data.response.docs)) {
    throw new Error("Internet Archive 搜索接口返回格式无效");
  }
  return data.response.docs;
}

async function requestArchiveMetadata(identifier) {
  var response = await Widget.http.get(IA_METADATA_URL + encodeURIComponent(identifier));
  var data = parseResponseData(response);
  if (!data || typeof data !== "object" || !data.metadata) {
    throw new Error("Internet Archive 元数据接口返回格式无效");
  }
  return data;
}

function parseResponseData(response) {
  var data = response && response.data;
  if (typeof data === "string") return JSON.parse(data);
  return data;
}

function mapSearchDocument(doc) {
  var identifier = stringValue(doc.identifier).trim();
  var ownedLink = makeOwnedLink(identifier);
  var coverUrl = makeImageUrl(identifier);
  var subjects = uniqueStrings(doc.subject);
  var license = getLicenseInfo(doc);
  var description = cleanText(doc.description);
  if (license) description = description ? description + "\n\n许可：" + license.label : "许可：" + license.label;

  return {
    id: ownedLink,
    type: "url",
    mediaType: "movie",
    title: cleanText(doc.title) || identifier,
    link: ownedLink,
    coverUrl: coverUrl,
    posterPath: coverUrl,
    backdropPath: coverUrl,
    releaseDate: normalizeDate(doc.date || doc.publicdate || doc.year),
    description: description,
    genreTitle: subjects.slice(0, 5).join(" / ")
  };
}

function isPlayableOpenMovie(item) {
  if (!item || !item.metadata) return false;
  var metadata = item.metadata;
  if (stringValue(metadata.mediatype).toLowerCase() !== "movies") return false;
  if (!getLicenseInfo(metadata)) return false;
  if (isRestricted(item, metadata)) return false;
  return selectPublicMp4Files(item.files).length > 0;
}

function isRestricted(item, metadata) {
  var flags = [
    item.is_dark,
    item.nodownload,
    item["access-restricted-item"],
    metadata.is_dark,
    metadata.nodownload,
    metadata["no-download"],
    metadata["access-restricted-item"]
  ];
  return flags.some(isTruthyFlag);
}

function isTruthyFlag(value) {
  if (value === true || value === 1) return true;
  var normalized = stringValue(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function hasAllowedLicense(doc) {
  return !!getLicenseInfo(doc);
}

function getLicenseInfo(metadata) {
  metadata = metadata || {};
  var urls = uniqueStrings(metadata.licenseurl);
  for (var i = 0; i < urls.length; i += 1) {
    var url = urls[i].trim();
    if (/^https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/publicdomain(?:\/|$)/i.test(url)) {
      return { label: "Public Domain", url: url };
    }
    var licenseMatch = url.match(/^https?:\/\/(?:www\.)?creativecommons\.org\/licenses\/([^\/?#]+)\/([^\/?#]+)/i);
    if (licenseMatch) {
      return {
        label: "CC " + licenseMatch[1].toUpperCase() + " " + licenseMatch[2],
        url: url
      };
    }
    if (/^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/zero\//i.test(url)) {
      return { label: "CC0 公版", url: url };
    }
    if (/^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/mark\//i.test(url)) {
      return { label: "Public Domain Mark", url: url };
    }
  }

  var rights = uniqueStrings(metadata.rights).join(" ").trim();
  if (/^(?:public domain|cc0|no known copyright restrictions)[.!]?$/i.test(rights) || /^(?:this (?:work|item) is |dedicated to )(?:in )?(?:the )?public domain[.!]?$/i.test(rights)) {
    return { label: "Public Domain", url: "" };
  }
  return null;
}

function selectPublicMp4Files(files) {
  if (!Array.isArray(files)) return [];
  return files.filter(function (file) {
    if (!file || typeof file.name !== "string" || isTruthyFlag(file.private)) return false;
    var name = file.name.toLowerCase();
    if (!/\.mp4$/.test(name)) return false;
    if (/(^|[._ -])(sample|trailer|preview)([._ -]|$)/i.test(file.name)) return false;
    return true;
  }).sort(function (left, right) {
    var difference = scoreMp4(right) - scoreMp4(left);
    if (difference) return difference;
    return stringValue(left.name) < stringValue(right.name) ? -1 : 1;
  }).slice(0, 8);
}

function scoreMp4(file) {
  var formatAndName = (stringValue(file.format) + " " + stringValue(file.name)).toLowerCase();
  var score = 0;
  if (/h[. _-]?264|avc/.test(formatAndName)) score += 800;
  if (formatAndName.indexOf("mpeg4") !== -1) score += 300;
  if (stringValue(file.source).toLowerCase() === "original") score += 250;
  if (formatAndName.indexOf("512kb") !== -1) score -= 100;
  var width = positiveNumber(file.width);
  var height = positiveNumber(file.height);
  score += Math.min(700, Math.round((width * height) / 4000));
  score += Math.min(100, Math.round(positiveNumber(file.size) / 100000000));
  return score;
}

function collectBackdropUrls(identifier, files, coverUrl) {
  var imageFiles = Array.isArray(files) ? files.filter(function (file) {
    if (!file || typeof file.name !== "string" || isTruthyFlag(file.private)) return false;
    if (!/\.(?:jpe?g|png|webp)$/i.test(file.name)) return false;
    return !/(?:^|[._-])(?:thumb|thumbnail|spectrogram)(?:[._-]|$)/i.test(file.name);
  }).sort(function (left, right) {
    return positiveNumber(right.size) - positiveNumber(left.size);
  }).slice(0, 7) : [];

  return uniqueStrings([coverUrl].concat(imageFiles.map(function (file) {
    return makeDownloadUrl(identifier, file.name);
  })));
}

function resourceName(file, index) {
  var height = positiveNumber(file.height);
  var quality = height ? height + "p" : stringValue(file.format) || "MP4";
  var origin = stringValue(file.source).toLowerCase() === "original" ? "原始文件" : "转码文件";
  return quality + " · " + origin + (index > 0 && !height ? " " + (index + 1) : "");
}

function resourceDescription(file) {
  var parts = [];
  var width = positiveNumber(file.width);
  var height = positiveNumber(file.height);
  if (width && height) parts.push(width + "×" + height);
  if (file.format) parts.push(stringValue(file.format));
  var size = positiveNumber(file.size);
  if (size) parts.push(formatBytes(size));
  parts.push(stringValue(file.name));
  return parts.join(" | ");
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function parseOwnedLink(value) {
  if (typeof value !== "string" || value.slice(0, 3) !== "ia:") return null;
  var identifier = value.slice(3);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(identifier)) return null;
  return identifier;
}

function makeOwnedLink(identifier) {
  return "ia:" + identifier;
}

function makeImageUrl(identifier) {
  return IA_IMAGE_URL + encodeURIComponent(identifier);
}

function makeDownloadUrl(identifier, fileName) {
  return IA_DOWNLOAD_URL + encodeURIComponent(identifier) + "/" + encodePath(fileName);
}

function encodePath(value) {
  return stringValue(value).split("/").map(function (segment) {
    return encodeURIComponent(segment);
  }).join("/");
}

function escapeArchivePhrase(value) {
  return stringValue(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
}

function wrapQueryPart(value) {
  return "(" + value + ")";
}

function normalizePage(value) {
  var page = Math.floor(positiveNumber(value) || 1);
  return Math.max(1, page);
}

function normalizeCount(value) {
  var count = Math.floor(positiveNumber(value) || 20);
  return Math.max(1, Math.min(50, count));
}

function normalizeDate(value) {
  var text = stringValue(value).trim();
  if (!text) return "";
  var match = text.match(/^\d{4}(?:-\d{2}(?:-\d{2})?)?/);
  return match ? match[0] : text;
}

function positiveNumber(value) {
  var number = Number(value);
  return isFinite(number) && number > 0 ? number : 0;
}

function stringValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.length ? stringValue(value[0]) : "";
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function uniqueStrings(value) {
  var input = Array.isArray(value) ? value : [value];
  var result = [];
  var seen = {};

  function append(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(append);
      return;
    }
    var text = stringValue(entry).trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    result.push(text);
  }

  input.forEach(append);
  return result;
}

function cleanText(value) {
  var text = uniqueStrings(value).join("; ");
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
