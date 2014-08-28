module.exports = function(grunt) {
  
  grunt.file.preserveBOM = false;

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    
    http: {
      courses: {
        options: {          
          timeout: 60000,
          
          encoding:'utf-8',
          
          url: 'http://protosgolf.com/golf/gateway',
          method: 'POST',
          
          form: {
            clubregex: '',
            city: 'Any'
          },
          
          headers: {
            'P3P-Origin': 'AJAX',
            'P3P-Request': 'CLUBSEARCH',
            'Content-type': 'application/json; charset=utf-8'
          },
          
          callback: function(error, response, body) {
            
            var courses =  JSON.stringify(body);
            
            // Handling UTF-* Replacement Character from dodgy data.
            courses = body.replace('\\\uFFFD', ' ');
            
            grunt.file.write('data/courses.json', courses);
          }
        }
      }
    },
    
    jsonlint: {
      sample: {
        src: ['data/courses.json']
      }
    }
  });

  // Load the plugin that provides the "uglify" task.
  grunt.loadNpmTasks('grunt-http');
  
  grunt.loadNpmTasks('grunt-jsonlint');

  // Default task(s).  
  grunt.registerTask('updatejson', function () {
  
      var coursesJSONFile = "data/courses.json";
      
      var coursesJSON = grunt.file.readJSON(coursesJSONFile);
      
      grunt.log.write(coursesJSON.resultset.length);

  });

  // Get all course data and then iterate through ids to populate each course with detailed data.  
  grunt.registerTask('default', 'Get Courses', function() {
    // Enqueue "bar" and "baz" tasks, to run after "foo" finishes, in-order.
    grunt.task.run('http:courses', 'updatejson');
  });

};