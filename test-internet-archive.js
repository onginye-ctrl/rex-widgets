const path = require("path");

process.argv[2] = path.join(__dirname, "widgets", "internet_archive.js");
process.argv[3] = "org.archive.openmovies";
process.argv[4] = "2.0.0";

require("./test-chinese-catalog.js");
