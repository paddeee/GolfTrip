'use strict';

// Include Gulp & Tools We'll Use
var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var del = require('del');
var runSequence = require('run-sequence');
var browserSync = require('browser-sync');
var pagespeed = require('psi');
var request = require('request');
var reload = browserSync.reload;
var file = require('gulp-file');
var xml2json = require('gulp-xml2json');
var fs = require('fs');
var tap = require('gulp-tap');
var async = require('async');
var _ = require('lodash');
var firebase = require('firebase');

// Return European clubs based off geo-coordinates
var getWestEuropeanClubs = function(clubData) {

  var lat = clubData.latitude;
  var long = clubData.longitude;

  if (lat > 36 && lat < 59 && long > -11 && long < 3) {
    return true;
  }

  return false;
}

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

        // Array to temporarily store all course ids
        var courseIdCollection =[];

        // Use async to limit requests to just one concurrent worker. This should avoid
        // slamming the API server.
        var q = async.queue(function (task, done) {
            request(task, function(error, response, body) {

                if (error) return done(error);
                if (response.statusCode != 200) return done(response.statusCode);

                file('course.xml', body)
                    .pipe(xml2json())
                    .pipe(tap(function(file, t) {

                        // If file hasn't come back empty of items
                        if (JSON.parse(String(file.contents)).items != '') {

                            // Push each course onto the courseIdsCollection Array
                            for (var i = 0; i < JSON.parse(String(file.contents)).items.item.length; i++) {
                                courseIdCollection.push(JSON.parse(String(file.contents)).items.item[i].id[0]);
                            }
                       }
                       setTimeout(function() {
                          done();
                       }, 1000);
                    }));
            });
        }, 1);

        // When all requests are complete we can write the file.
        q.drain = function() {

            // Remove duplicate entries
            courseIdCollection = _.uniq(courseIdCollection);

            return file('courseids.json', JSON.stringify(courseIdCollection))
                .pipe(gulp.dest('data'));
        }

        // For every object in the JSON file add to the request queue.
        for (var i = 0; i < courses.resultset.length; i++) {

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

// Create Club Details JSON file
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

                // Replace non entities & with &amp; for valid XML
                body = body.replace(/(\s&\s)/g, " &amp; ");

              file('coursedetails.xml', body)
                .pipe(xml2json())
                .pipe(tap(function(file, t) {
                    // Push course JSON to temporary array
                    courseDetailsCollection.push(String(file.contents));

                   setTimeout(function() {
                      done();
                   }, 200);
                }));
            });
        }, 1);

        // When all requests are complete we can write the file.
        q.drain = function() {
            return file('coursedetails.json', JSON.stringify(courseDetailsCollection))
                .pipe(gulp.dest('data'));
        }

        // For every object in the JSON file add to the request queue.
        for (var i = 0; i < courses.length; i++) {

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
                    course_id: courses[i]
                },
                i: i
            };

          // Push options object onto async queue
            q.push(options);
        }
    });
});

// Set Firebase Club list from coursedetails.json
gulp.task('createfirebaseclublist', function () {

  fs.readFile('data/courselist.json', 'utf8', function (err, data) {

    var clubs = JSON.parse(data).resultset;
    var clubList = [];

    _.forEach(clubs, function (clubData) {

      var newClub = {};
      var id;

      // Build new club object
      id = clubData.id;
      newClub['clubid:' + id] = {};
      newClub['clubid:' + id] = clubData;

      if (getWestEuropeanClubs(clubData)) {
        clubList.push(newClub);
      }

    });

    // Write the data to the file
    saveClubListToFireBase(clubList);

    function saveClubListToFireBase(clubList) {

      var config = {
        apiKey: "AIzaSyCtyzUWtbcPhcMrBoBBUZ4Fsn0guTUuyDI",
        authDomain: "incandescent-heat-3687.firebaseapp.com",
        databaseURL: "https://incandescent-heat-3687.firebaseio.com",
        projectId: "incandescent-heat-3687",
        storageBucket: "incandescent-heat-3687.appspot.com",
        messagingSenderId: "602114181418"
      };

      firebase.initializeApp(config);

      _.forEach(clubList, function(clubInfo) {

        firebase.database().ref('clublist/' + Object.keys(clubInfo)[0]).set(clubInfo[Object.keys(clubInfo)[0]]);

      });
    }

  });
});

// Set Firebase coursedetails from coursedetails.json
gulp.task('createfirebaseclubdetails', function () {

  fs.readFile('data/coursedetails.json', 'utf8', function (err, data) {

    var clubs = JSON.parse(data);
    var newClubList = [];
    var tempClubList = [];
    var MultipleCourseIdList;

    _.forEach(clubs, function(clubdata) {

      var newClub = {};
      var courseDetails;
      var club;
      var id;
      var name;
      var address;
      var course;

      courseDetails = JSON.parse(clubdata).coursedetails;
      club = courseDetails.club[0];
      id = club.$.id;
      name = club.name[0];
      address = club.address[0];
      course = courseDetails.course[0];

      // Build new club object
      newClub['clubid:' + id] = {};
      newClub['clubid:' + id].id = id;
      newClub['clubid:' + id].name = name;
      newClub['clubid:' + id].address = createValidAddressObject(address);
      newClub['clubid:' + id].courses = [];

      // Build new course object
      var newCourse = {};
      var greenCentre = course.greencenter[0];
      var teeBoxes = course.teeboxes[0].teebox;

      newCourse.id = course.$.id;
      newCourse.name = course.name[0];
      newCourse.map = course.map[0];
      newCourse.length = course.length[0];
      newCourse.par = course.par[0].split(',');
      newCourse.stroke = course.handicap[0].split(',');
      newCourse.greencentre = createGreenCentreObject(greenCentre);
      newCourse.teeboxes = createTeeBoxesArray(teeBoxes);

      // Add course to the courses array property
      newClub['clubid:' + id].courses.push(newCourse);

      // Add club to the tempClubList array. Creates club objects without ids in the keys to make manipulating easier
      tempClubList.push(newClub['clubid:' + id]);

      // Add club to the newClubList array
      newClubList.push(newClub);

    });

    // Get array of clubs with multiple courses
    MultipleCourseIdList = getClubsWitMultipleCourses(tempClubList);

    // For each club with multiple courses, create a club object of multiple courses.
    // Remove current club objects with the id from the array, then add the new merged one.
    _.forEach(MultipleCourseIdList, function(clubId) {

      var duplicatesArray = _.filter(newClubList, function(club) {
        return club['clubid:' + clubId];
      });

      mergeClubData(newClubList, clubId, createSingleClubObject(duplicatesArray, clubId));
    });

    // Write the data to the file
    saveClubDetailsToFireBase(newClubList);

    function saveClubDetailsToFireBase(newClubList) {

      var clubDetailsFireBase;

      _.forEach(newClubList, function(clubDetails) {

        clubDetailsFireBase = new Firebase('https://incandescent-heat-3687.firebaseio.com/clubdetails/' + Object.keys(clubDetails)[0]);
        clubDetailsFireBase.set(clubDetails[Object.keys(clubDetails)[0]]);
      });
    }

    function createSingleClubObject(duplicatesArray, clubId) {

      var clubObject = duplicatesArray[0];
      var objectsToRemoveArray;
      var courses = clubObject['clubid:' + clubId].courses;

      // Remove first Object from Array as we'll use this to add courses too
      objectsToRemoveArray = duplicatesArray.slice(1, duplicatesArray.length);

      // For each object being removed get courses data and push it onto courses array
      _.forEach(objectsToRemoveArray, function(club) {
        _.forEach(club['clubid:' + clubId].courses, function(course) {

          courses.push(course);
        });
      });

      return clubObject;
    }

    function getClubsWitMultipleCourses(newClubList) {

      return _.keys(_.omit(_.countBy(newClubList, function(club) {
        return club.id;
      }), function(clubId) {
        return clubId === 1;
      }));
    }

    function mergeClubData(newClubList, clubId, mergedClubObject) {

      _.remove(newClubList, function(club) {
          return club['clubid:' + clubId];
      });

      newClubList.push(mergedClubObject);
    }

    function createValidAddressObject(addressObject) {
      addressObject.street = addressObject.street[0];
      addressObject.city = addressObject.city[0];
      addressObject.country = addressObject.country[0];

      return addressObject;
    }

    function createGreenCentreObject(greenCentreObject) {

      greenCentreObject.coords = greenCentreObject._.split(',');
      greenCentreObject.units = greenCentreObject.$.units;
      delete greenCentreObject._;
      delete greenCentreObject.$;

      return greenCentreObject;
    }

    function createTeeBoxesArray(teeBoxArray) {

      var newTeeBoxArray = [];

      _.forEach(teeBoxArray, function(teeBox) {

        teeBox.name = teeBox.name[0];
        teeBox.designation = teeBox.designation[0];
        teeBox.slope = teeBox.slope[0];
        teeBox.rating = teeBox.rating[0];
        teeBox.distance = createDistanceObject(teeBox.distance[0]);

        newTeeBoxArray.push(teeBox);
      });

      return newTeeBoxArray;
    }

    function createDistanceObject(distanceObject) {

      distanceObject.length = distanceObject._.split(',');
      distanceObject.units = distanceObject.$.units;
      delete distanceObject._;
      delete distanceObject.$;

      return distanceObject;
    };

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
