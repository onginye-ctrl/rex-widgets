WidgetMetadata = {
  id: "org.catalog.chinese",
  title: "华语影视目录",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  description: "浏览华语电影与剧集的完整目录：热门、高分、最新，支持按地区筛选与关键词搜索。目录数据每日更新，详情页由客户端内置 TMDB 详情渲染。",
  author: "Cashbox",
  site: "https://www.themoviedb.org",
  detailCacheDuration: 3600,
  modules: [
    {
      id: "catalog",
      title: "华语影视",
      functionName: "loadList",
      cacheDuration: 1800,
      requiresWebView: false,
      sectionMode: false,
      params: [
        {
          name: "category",
          title: "分类",
          type: "enumeration",
          value: "movie_popular",
          enumOptions: [
            { title: "热门电影", value: "movie_popular" },
            { title: "高分电影", value: "movie_top" },
            { title: "最新电影", value: "movie_new" },
            { title: "热门剧集", value: "tv_popular" },
            { title: "高分剧集", value: "tv_top" },
            { title: "最新剧集", value: "tv_new" }
          ]
        },
        {
          name: "region",
          title: "地区",
          type: "enumeration",
          value: "all",
          enumOptions: [
            { title: "全部华语", value: "all" },
            { title: "中国大陆", value: "CN" },
            { title: "香港", value: "HK" },
            { title: "台湾", value: "TW" }
          ]
        },
        { name: "page", title: "页码", type: "page" }
      ]
    }
  ],
  search: {
    title: "搜索影视",
    functionName: "search",
    params: [
      { name: "keyword", title: "关键词", type: "input" },
      { name: "page", title: "页码", type: "page" }
    ]
  }
};

var CATEGORIES = {
  movie_popular: { path: "discover/movie", mediaType: "movie", sort: "popularity.desc" },
  movie_top: { path: "discover/movie", mediaType: "movie", sort: "vote_average.desc", minVotes: 200 },
  movie_new: { path: "discover/movie", mediaType: "movie", sort: "primary_release_date.desc", minVotes: 10 },
  tv_popular: { path: "discover/tv", mediaType: "tv", sort: "popularity.desc" },
  tv_top: { path: "discover/tv", mediaType: "tv", sort: "vote_average.desc", minVotes: 100 },
  tv_new: { path: "discover/tv", mediaType: "tv", sort: "first_air_date.desc", minVotes: 10 }
};

var REGIONS = {
  all: { with_original_language: "zh" },
  CN: { with_origin_country: "CN" },
  HK: { with_origin_country: "HK" },
  TW: { with_origin_country: "TW" }
};

async function loadList(params) {
  params = params || {};
  var category = CATEGORIES[String(params.category || "movie_popular")] || CATEGORIES.movie_popular;
  var requestParams = {
    language: "zh-CN",
    page: normalizePage(params.page),
    sort_by: category.sort
  };

  var region = REGIONS[String(params.region || "all")] || REGIONS.all;
  if (region.with_original_language) requestParams.with_original_language = region.with_original_language;
  if (region.with_origin_country) {
    requestParams.with_origin_country = region.with_origin_country;
    requestParams.with_original_language = "zh";
  }
  if (category.minVotes) requestParams["vote_count.gte"] = category.minVotes;

  var response = await Widget.tmdb.get(category.path, { params: requestParams });
  var results = response && Array.isArray(response.results) ? response.results : [];
  return results.map(function (item) {
    return mapVideoItem(item, category.mediaType);
  });
}

async function search(params) {
  params = params || {};
  var keyword = String(params.keyword || "").trim();
  if (!keyword) return [];

  var response = await Widget.tmdb.get("search/multi", {
    params: {
      query: keyword,
      page: normalizePage(params.page),
      language: "zh-CN",
      include_adult: false
    }
  });
  var results = response && Array.isArray(response.results) ? response.results : [];
  return results
    .filter(function (item) {
      return item && (item.media_type === "movie" || item.media_type === "tv");
    })
    .map(function (item) {
      return mapVideoItem(item, item.media_type);
    });
}

function mapVideoItem(item, mediaType) {
  var title = item.title || item.name || item.original_title || item.original_name || "";
  var date = item.release_date || item.first_air_date || "";
  var vote = Number(item.vote_average);

  var video = {
    id: item.id,
    type: "tmdb",
    mediaType: mediaType,
    title: title,
    posterPath: item.poster_path || "",
    backdropPath: item.backdrop_path || "",
    releaseDate: date,
    description: item.overview || ""
  };
  if (isFinite(vote) && vote > 0) video.rating = vote;
  return video;
}

function normalizePage(value) {
  var page = Math.floor(Number(value));
  if (!isFinite(page) || page < 1) return 1;
  return Math.min(500, page);
}
