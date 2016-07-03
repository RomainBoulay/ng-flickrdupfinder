'use strict';

require('./../../bower_components/ui.bootstrap/src/pagination/pagination');

module.exports = angular.module(
  'flickrDupFinderControllers',
  ['ui.bootstrap.pagination',
   require('./config').name,
   require('./services').name,
   require('./uservoice-shim').name,
   require('./keen-shim').name])
  .controller(
    'startCtrl',
    ['$http', 'OAUTHD_URL', '$log', function($http, OAUTHD_URL, $log) {
      $http.get(OAUTHD_URL + '/auth/flickr').success(function(success) {
        $log.debug("oauthd ping successful:", success);
      });
    }])
  .controller(
    'photoCtrl',
    ['$scope', '$window', '$log', 'Flickr', 'UserVoice', 'Keen', function($scope, $window, $log, Flickr, UserVoice, Keen) {
      var _ = require('lodash');
      var specialTag = 'dupdup';
      $scope.itemsPerPage = 160;
      $scope.maxSize = 100;

      $scope.toggleTag = function(photo) {
        if (photo.duplicate) {
          removeTag(photo);
        } else {
          addTag(photo);
        }
      };

      $scope.handlePhoto = function(evt, photo) {
        switch (evt.which) {
            case 1:
                $scope.toggleTag(photo);
                break;
            case 2:
            case 3:
                $window.open('https://www.flickr.com/photos/romainboulay/' + photo.id, '_blank');
                break;
            default:
                alert("you have a strange mouse!");
                break;
        }
      };

      function addTag(photo) {
        if (_.contains(photo.tags, specialTag)) {
          console.log("addTag. skipping:", photo.id, photo.title, photo.tags);
          return;
        }

        console.log("addTag. tagging", photo.id, photo.title, photo.tags);
        photo.inFlight = true;
        Flickr.get({
          method: 'flickr.photos.addTags',
          photo_id: photo.id,
          tags: specialTag
        }, function() {
          photo.duplicate = true;
          photo.inFlight = false;
        });
      }

      function removeTag(photo) {
        photo.inFlight = true;
        Flickr.get({
          method: 'flickr.photos.getInfo',
          photo_id: photo.id
        }, function(info) {
          var tag =
            _.find(info.photo.tags.tag, function(tag) {
              return tag.raw === specialTag;
            });
          if (tag) {
            Flickr.get({
              method: 'flickr.photos.removeTag',
              photo_id: photo.id,
              tag_id: tag.id
            }, function() {
              photo.duplicate = false;
              photo.inFlight = false;
            });
          } else {
            photo.inFlight = false;
          }
        });
      }

      $scope.autoTag = function() {
        _.map($scope.visibleGroups, function(group) {
          _.map(_.rest(group), addTag);
        });
      };

      $scope.autoTagOrphan = function() {
        var number = 0;
        _.map($scope.visibleGroups, function(group) {
          group.forEach(function (photo, index, array) {
            if (_.contains(photo.tags, "orphanphotos")) {
              addTag(photo);
              number = number + 1;
            }
          });
        });
        console.log("Done autoTagOrphan", number);
      };

      $scope.autoTagAll = function() {
        var number = 0;
        _.map($scope.visibleGroups, function(group) {
          group.forEach(function (photo, index, array) {
            if (_.contains(photo.tags, "autoupload") == false) {
              addTag(photo);
              number = number + 1;
            }
          });
        });
        console.log("Done autoTagAll", number);
      };

      function updateDuplicateState(photo) {
        photo['duplicate'] = _.contains(photo.tags.split(/ /), specialTag);
        return photo;
      }

      function fingerprint(photo) {
        // console.log("photo", photo);
        return photo.datetaken;
        // return '##' + photo.title.replace(/-[0-9]$/, '');
        // return photo.datetaken + '##' + photo.title.replace(/-[0-9]$/, '');
      }

      function atLeastTwo(group) {
        return group.length > 1;
      }

      function groupDuplicates(photos) {
        var groups = _.groupBy(photos, fingerprint);
        var groups2 = _.filter(groups, atLeastTwo);
        $scope.groups = groups2;
        updateVisibleGroups();
      }

      function getPage(page, photosAcc) {
        $scope.page = page;
        var getPageRetry = function(retries) {
          Flickr.get({
            method: "flickr.photos.search",
            page: page,
            per_page: 500,
            sort: 'date-taken-asc'}, function(result) {
              $scope.totalPages = result.photos.pages;
              var resultPhotos = result.photos.photo;
              var updatedResultPhotos =
                _.map(resultPhotos, updateDuplicateState);
              var photosAcc2 = photosAcc.concat(updatedResultPhotos);
              if (page < result.photos.pages) {
                getPage(page + 1, photosAcc2);
              } else {
                $scope.initialDownload = false;
                doTrack(photosAcc2.length);
              }
              groupDuplicates(photosAcc2);
            }, function(error) {
              $log.debug("getPage error:", error);
              if (retries < 3) {
                $log.debug("getPage retries:", retries);
                getPageRetry(retries + 1);
              }
            });
        };
        getPageRetry(0);
      }

      function updateVisibleGroups() {
        $scope.totalItems = _.size($scope.groups);
        var first = (($scope.currentPage - 1) * $scope.itemsPerPage);
        var last = $scope.currentPage * $scope.itemsPerPage;
        $scope.visibleGroups =
          _.pick($scope.groups, _.keys($scope.groups).slice(first, last));
      }

      function doTrack(totalPhotoCount) {
        var event = {
          id: id,
          name: name,
          photos: totalPhotoCount,
          groups: $scope.groups.length,
          loadTimeMs: Date.now() - startTime,
          keen: {
            timestamp: new Date().toISOString()
          }
        };

        Keen.addEvent("loading_complete", event, function(){});
      }

      var id = "";
      var name = "";
      var startTime = Date.now();
      Flickr.get({
        method: "flickr.test.login"
      }, function(data) {
        $log.debug("flickr.test.login", data.user);
        UserVoice.push(['identify', {
          id: data.user.id,
          name: data.user.username._content
        }]);
        UserVoice.push(['autoprompt', {}]);
        id = data.user.id;
        name = data.user.username._content;
      });

      $scope.pageChanged = function() {
        updateVisibleGroups();
      };

      $scope.totalItems = 0;
      $scope.currentPage = 1;
      $scope.initialDownload = true;
      getPage(1, []);
    }]);
