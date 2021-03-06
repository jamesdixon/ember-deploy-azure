var CoreObject  = require('core-object');
var Promise     = require('ember-cli/lib/ext/promise');
var SilentError = require('ember-cli/lib/errors/silent');
var RSVP        = require('rsvp');
var azure       = require('azure-storage');
var walk        = require('walk');
var fs          = require('fs');
var chalk       = require('chalk');
var path        = require('path');
var mime        = require('mime');

var green = chalk.green;
var white = chalk.white;

var AZURE_CONTAINER_NAME = 'emberdeploy';

module.exports = CoreObject.extend({
  init: function() {
    CoreObject.prototype.init.apply(this, arguments);
    if (!this.config) {
      return Promise.reject(new SilentError('You have to pass a config!'));
    }

    var config = this.config.assets;

    // be transparant to either passing a connectionString or the storageAccount + storageAccessKey
    if(config.connectionString) {
      this.client = azure.createBlobService(config.connectionString);
    } else if (config.storageAccount && config.storageAccessKey) {
      this.client = azure.createBlobService(config.storageAccount, config.storageAccessKey);
    } else {
      console.error("No connection string or storage account plus access key set for this Azure deployment.");
      return Promise.reject(new SilentError('No connection string or storage account plus access key set for this Azure deployment.'));
    }

    // if a storage container name is defined in the config, use it instead of the default
    if(config.containerName) {
      AZURE_CONTAINER_NAME = config.containerName;
    }
  },

  upload: function() {
    var _this = this;
    var blobService = this.client;

    if (!this.ui) {
      var message = 'You have to pass a UI to an adapter.';
      return Promise.reject(new SilentError(message));
    }

    this.ui.pleasantProgress.start(green('Uploading assets'), green('.'));

    return new Promise(function(resolve, reject) {
      // create container
      blobService.createContainerIfNotExists(AZURE_CONTAINER_NAME, {publicAccessLevel : 'blob'}, function(error, result, response){
        if(!error){
          // set CORS

          var serviceProperties = {};

          serviceProperties.Cors = {
            CorsRule: [{
              AllowedOrigins: ['*'],
              AllowedMethods: ['GET'],
              AllowedHeaders: [],
              ExposedHeaders: [],
              MaxAgeInSeconds: 60
            }]
          };

          blobService.setServiceProperties(serviceProperties, function(error, result, response) {
            if(!error) {
              // walk the directory to be uploaded
              walker = walk.walk("tmp/assets-sync", { followLinks: false });

              walker.on("file", _this._uploadFile.bind(_this));

              walker.on("errors", function(root, nodeStatsArray, next) {
                nodeStatsArray.forEach(function (n) {
                  console.error("[ERROR] " + n.name);
                  console.error(n.error.message || (n.error.code + ": " + n.error.path));
                });
                reject();
              });

              walker.on("end", function() {
                resolve();
              });
            } else {
              reject(error);
            }
          });
        } else {
          reject(error);
        }
      });
    });
  },

  _uploadFile: function(root, fileStat, next) {
    var _this = this;
    var blobService  = this.client;

    var resolvedFile = path.resolve(root, fileStat.name);
    var targetDirectory = path.normalize(root).replace("tmp" + path.sep + "assets-sync" + path.sep, "");
    var targetFile = targetDirectory + path.sep + fileStat.name;

    var options = {}

    var extname = path.extname(resolvedFile).replace('.');
    var gzipExtensions = this.config.assets.gzipExtensions ? this.config.assets.gzipExtensions : ['js', 'css', 'svg']
    var hasBeenGziped = gzipExtensions.indexOf(extname) !== -1;

    if(this.config.assets.gzip !== false && hasBeenGziped) {
      options["contentEncoding"] = "gzip";
    }

    blobService.doesBlobExist(AZURE_CONTAINER_NAME, targetFile, function(error, blobExists, response) {
      if(blobExists === true) {
        next();
      } else {
        blobService.createBlockBlobFromLocalFile(AZURE_CONTAINER_NAME, targetFile, resolvedFile, options, function(error, result, response){
          if(!error){
            // file uploaded
          } else {
            console.error("Error uploading " + targetFile);
            console.log(error);
          }

          next();
        });
      }
    });
  }
});
