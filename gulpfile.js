/**
 *
 *  Web Starter Kit
 *  Copyright 2014 Google Inc. All rights reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License
 *
 */

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
var RateLimiter = require('limiter').RateLimiter;
var tap = require('gulp-tap');


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
  var callback = function(error, response, body) {    
    // Handling UTF-* Replacement Character from dodgy data.
    courselist = body.replace('\\\uFFFD', ' ');    
    return file('courselist.json', courselist)
      .pipe(gulp.dest('data'));
  }  
  request(options, callback);  
});

// Create Course Details JSON file
gulp.task('getcoursedetails', function () {
  
  fs.readFile('data/courselist.json', 'utf8', function (err, data) {    
  
    var courses = JSON.parse(data);
        
    var options = {
      url: 'http://protosgolf.com/golf/gateway',
      headers: {
        'P3P-Origin': 'XML_CLIENT',
        'P3P-Request': 'CD'
      },   
      method: 'POST',
      form: {
        course_id: ''
      }
    };
    
    var courseDetailsCollection =[];
      
    // Limit requests to prevent flooding server.
    var limiter = new RateLimiter(1, 5000);
      
    var throttledRequest = function() {
        var requestArgs = arguments;
        limiter.removeTokens(1, function() {
          request.apply(this, requestArgs);
        });
    };
    
    var callback = function(error, response, body) {
      return file('coursedetails.xml', body)
        .pipe(xml2json())
        .pipe(tap(function(file, t) {
          courseDetailsCollection.push(String(file.contents));
        }))
        //.pipe(gulp.dest('data'));    
    };
      
    for (var i = 0; i < 2; i++) {
      // Change the course id parameter for each request
      options.form.course_id = courses.resultset[i].id;
      
      // Call the throttled request.
      throttledRequest(options, callback);
      
      callback.on('data', function() {
        console.log(courseDetailsCollection.length);        
      });
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
