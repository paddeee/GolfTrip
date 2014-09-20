'use strict';

// Include Gulp & Tools We'll Use
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var del = require('del');
var runSequence = require('run-sequence');
var browserSync = require('browser-sync');
var pagespeed = require('psi');
var request = require('request');
var rename = require('gulp-rename');
var reload = browserSync.reload;
var file = require('gulp-file');
var xml2json = require('gulp-xml2json');
var fs = require('fs');
var tap = require('gulp-tap');
var jsonlint = require("gulp-jsonlint");
var async = require('async');


// Create Course List JSON file
gulp.task('getcourselist', function () {

    var courselist = '';

    var options = {
        url: 'http://protosgolf.com/golf/gateway',
        headers: {
            'P3P-Origin': 'AJAX',
            'P3P-Request': 'CLUBSEARCH',
            'Content-type': 'application/json; charset=utf-8'
        },
        timeout: 60000,
        method: 'POST',
        form: {
            clubregex: '',
            city: 'Any'
        }
    };

    var createCourseListFile = function(error, response, body) {

        // Handling UTF-* Replacement Character from dodgy data
        courselist = body.replace('\\\uFFFD', ' ');

        // Create JSON file of all courses
        return file('courselist.json', courselist)
            .pipe(gulp.dest('data'));
    }

    // Make the request to the JSON API endpoint for all courses
    request(options, createCourseListFile);
});

// Create Course IDs JSON file
gulp.task('getcourseids', function () {

    // Parse course names so they have more chance of returning
    // data from the Course List Request
    var parseCourseName = function(initialName) {

        // RegEx to match and then remove any numbers in brackets.
        var courseRegEx = /\(\d+\)/g;
        var parsedCourseName = initialName.replace(courseRegEx, "");
        return parsedCourseName;
    };

    fs.readFile('data/courselist.json', 'utf8', function (err, data) {

        var createClubObject;
        var courses = JSON.parse(data);
        var parsedCourseName;

        // Array to temporarily store all club id objects
        var clubIdCollection =[];

        // Create object containing club id and array of course ids
        createClubObject = function (clubId, courseIdArray) {
            return {
                clubId: clubId,
                courseIds: courseIdArray
            }
        };

        // Use async to limit requests to just one concurrent worker. This should avoid
        // slamming the API server.
        var q = async.queue(function (task, done) {
            request(task, function(error, response, body) {

                if (error) return done(error);
                if (response.statusCode != 200) return done(response.statusCode);

                file('course.xml', body)
                    .pipe(xml2json())
                    .pipe(tap(function(file, t) {

                        // Array to temporarily store all course ids
                        var courseIdCollection =[];

                        // If file hasn't come back empty of items
                        if (JSON.parse(String(file.contents)).items != '') {

                            // Push each course onto the courseIdsCollection Array
                            for (var i = 0; i < JSON.parse(String(file.contents)).items.item.length; i++) {
                                courseIdCollection.push(JSON.parse(String(file.contents)).items.item[i].id[0]);
                            }

                            // Push club object to clubIdCollection array
                            clubIdCollection.push(createClubObject(task.clubId, courseIdCollection));
                        }
                        done();
                    }));
            });
        }, 1);

        // When all requests are complete we can write the file.
        q.drain = function() {console.log(clubIdCollection.length);
            return file('courseids.json', JSON.stringify(clubIdCollection))
                .pipe(gulp.dest('data'));
        }

        // For every object in the JSON file add to the request queue.
        for (var i = 0; i < 30; i++) {

            // Parse course name so it's more likely to return a match.
            parsedCourseName = parseCourseName(courses.resultset[i].name);

            // Create new object each time otherwise the regex property gets updated too quickly
            // for the async task, as it is by reference.
            var options = {
                url: 'http://protosgolf.com/golf/gateway',
                headers: {
                    'P3P-Origin': 'XML_CLIENT',
                    'P3P-Request': 'CL'
                },
                method: 'POST',
                form: {
                    regex:  parsedCourseName,
                },
                clubId: courses.resultset[i].id
            };

            // Push options object onto async queue
            q.push(options);
        }
    });
});

// Create Course Details JSON file
gulp.task('getcoursedetails', function () {

    fs.readFile('data/courseids.json', 'utf8', function (err, data) {

        var courses = JSON.parse(data);

        // Array to temporarily store all course details objects
        var courseDetailsCollection =[];

        // Use async to limit requests to just one concurrent worker. This should avoid
        // slamming the API server.
        var q = async.queue(function (task, done) {
            request(task, function(error, response, body) {

                if (error) return done(error);
                if (response.statusCode != 200) return done(response.statusCode);

                file('coursedetails.xml', body)
                    .pipe(xml2json())
                    .pipe(tap(function(file, t) {
                        // Push course JSON to temporary array
                        courseDetailsCollection.push(String(file.contents));
                        done();
                    }));
            });
        }, 1);

        // When all requests are complete we can write the file.
        q.drain = function() {
            return file('coursedetails.json', JSON.stringify(courseDetailsCollection))
                .pipe(gulp.dest('data'));
        }

        // For every object in the JSON file add to the request queue.
        for (var i = 5; i < 6; i++) {

            // Create new object each time otherwise the regex property gets updated too quickly
            // for the async taskas it is by reference.
            var options = {
                url: 'http://protosgolf.com/golf/gateway',
                headers: {
                    'P3P-Origin': 'XML_CLIENT',
                    'P3P-Request': 'CD'
                },
                method: 'POST',
                form: {
                    course_id: courses[i].items.item[0].id[0]
                }
            };

            // Push options object onto async queue
            q.push(options);
        }
    });
});

// Lint JavaScript
gulp.task('jshint', function () {
    return gulp.src('app/scripts/**/*.js')
        .pipe($.jshint())
        .pipe($.jshint.reporter('jshint-stylish'))
        .pipe($.jshint.reporter('fail'))
        .pipe(reload({stream: true}));
});

// Optimize Images
gulp.task('images', function () {
    return gulp.src('app/images/**/*')
        .pipe($.cache($.imagemin({
            progressive: true,
            interlaced: true
        })))
        .pipe(gulp.dest('dist/images'))
        .pipe(reload({stream: true, once: true}))
        .pipe($.size({title: 'images'}));
});

// Automatically Prefix CSS
gulp.task('styles:css', function () {
    return gulp.src('app/styles/**/*.css')
        .pipe($.autoprefixer('last 1 version'))
        .pipe(gulp.dest('app/styles'))
        .pipe(reload({stream: true}))
        .pipe($.size({title: 'styles:css'}));
});

// Compile Sass For Style Guide Components (app/styles/components)
gulp.task('styles:components', function () {
    return gulp.src('app/styles/components/components.scss')
        .pipe($.rubySass({
            style: 'expanded',
            precision: 10,
            loadPath: ['app/styles/components']
        }))
        .pipe($.autoprefixer('last 1 version'))
        .pipe(gulp.dest('app/styles/components'))
        .pipe($.size({title: 'styles:components'}));
});

// Compile Any Other Sass Files You Added (app/styles)
gulp.task('styles:scss', function () {
    return gulp.src(['app/styles/**/*.scss', '!app/styles/components/components.scss'])
        .pipe($.rubySass({
            style: 'expanded',
            precision: 10,
            loadPath: ['app/styles']
        }))
        .pipe($.autoprefixer('last 1 version'))
        .pipe(gulp.dest('.tmp/styles'))
        .pipe($.size({title: 'styles:scss'}));
});

// Output Final CSS Styles
gulp.task('styles', ['styles:components', 'styles:scss', 'styles:css']);

// Scan Your HTML For Assets & Optimize Them
gulp.task('html', function () {
    return gulp.src('app/**/*.html')
        .pipe($.useref.assets({searchPath: '{.tmp,app}'}))
        // Concatenate And Minify JavaScript
        .pipe($.if('*.js', $.uglify()))
        // Concatenate And Minify Styles
        .pipe($.if('*.css', $.csso()))
        // Remove Any Unused CSS
        // Note: If not using the Style Guide, you can delete it from
        // the next line to only include styles your project uses.
        .pipe($.if('*.css', $.uncss({ html: ['app/index.html','app/styleguide/index.html'] })))
        .pipe($.useref.restore())
        .pipe($.useref())
        // Update Production Style Guide Paths
        .pipe($.replace('components/components.css', 'components/main.min.css'))
        // Minify Any HTML
        .pipe($.minifyHtml())
        // Output Files
        .pipe(gulp.dest('dist'))
        .pipe($.size({title: 'html'}));
});

// Clean Output Directory
gulp.task('clean', del.bind(null, ['.tmp', 'dist']));

// Watch Files For Changes & Reload
gulp.task('serve', function () {
    browserSync.init({
        server: {
            baseDir: ['app', '.tmp']
        },
        notify: false
    });

    gulp.watch(['app/**/*.html'], reload);
    gulp.watch(['app/styles/**/*.{css,scss}'], ['styles']);
    gulp.watch(['.tmp/styles/**/*.css'], reload);
    gulp.watch(['app/scripts/**/*.js'], ['jshint']);
    gulp.watch(['app/images/**/*'], ['images']);
});

// Build Production Files, the Default Task
gulp.task('default', ['clean'], function (cb) {
    runSequence('styles', ['jshint', 'html', 'images'], cb);
});

// Create golf course data from protos api
gulp.task('getcoursedata', ['getcourselist'], function (cb) {
    //runSequence('getcourselist', cb);
});

// Run PageSpeed Insights
// Update `url` below to the public URL for your site
gulp.task('pagespeed', pagespeed.bind(null, {
    // By default, we use the PageSpeed Insights
    // free (no API key) tier. You can use a Google
    // Developer API key if you have one. See
    // http://goo.gl/RkN0vE for info key: 'YOUR_API_KEY'
    url: 'https://example.com',
    strategy: 'mobile'
}));
