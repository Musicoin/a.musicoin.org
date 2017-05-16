var fs = require("fs");
var xgettext = require("xgettext-template");
var upath = require('upath');
var recursiveReadSync = require('recursive-readdir-sync');
var gettextDirectories = ["src/views", "src/overview"];

// Load all files that contain gettext strings into an array.
function gettextSources() {
	var sources = [];

	for(var i in gettextDirectories) {
		const directory = gettextDirectories[i];

		var files;
		try {
			files = recursiveReadSync(directory);
		} catch(err) {
			throw err;
		}

		for(var j in files) {
			const file = files[j];

			if(/^.*\.(ejs|html)$/.test(file)) {
				sources.push(upath.normalize(file).replace("src/", ""));
			}
		}
	}

	return sources;
}

var xgettextOptions = {
	directory: "./src",
	output: './src/locales/' + process.argv[2] + '/app.po',
	language: "EJS",
	'from-code': 'utf8',
	keyword: ["gettext", "_", "dgettext:2", "_d:2", "ngettext:1,2", "_n:1,2", "dngettext:2,3", "_dn:2,3",
			  "pgettext:1c,2", "_p:1c,2", "dpgettext:2c,3", "_dp:2c,3", "npgettext:2c,3,4",
			  "_np:2c,3,4", "dnpgettext:2c,3,4", "_dnp:2c,3,4"],
	'join-existing': true,
	'force-po': true
};

try {
    fs.mkdirSync("src/locales/" + process.argv[2]);
} catch (err) {
    if (err.code !== 'EEXIST') throw err
}

xgettext(gettextSources(), xgettextOptions, function (po) {
	if (po && (xgettextOptions.output === '-' || xgettextOptions.output === '/dev/stdout')) {
		process.stdout.write(po);
	}
});
