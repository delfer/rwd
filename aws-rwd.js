#!/usr/bin/js
//depends on aws-sdk, request
//Request URL:https://cloud-images.ubuntu.com/locator/ec2/releasesTable?_=1490290382256

    var RWDRequest = {
        "region": "us-west-1.*",
        "instanceType": ".*",
        "ubuntuRelease": "16.04"
};

//Initial conf
var AWS = require('aws-sdk');
AWS.config.update({region: 'eu-central-1'});
var ec2 = new AWS.EC2();

var whenReady = function () {
    var regionsReq = getRegions();
    regionsReq.then((regions) => getCheapest(regions)).then(a => {console.log(a)});
    regionsReq.then((regions) => getUbuntuAMIs(regions)).then(a => {console.log(a)});;
};

var getRegions = function () {
    return new Promise(function(resolve, reject) {
        ec2.describeRegions({}, (err, data) => {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject();
            } else {
                var regions =
                    data["Regions"]
                        .map((a)=> a["RegionName"])
                        .filter((b) => (b.search(RWDRequest["region"]) > -1));
                resolve(regions);
            }
        });
    });
};

var getCheapest = function (regions) {
    return new Promise(function(resolve, reject) {
        var regionRequests =
            regions
                .map((i) => getCheapestInRegion(i));

        Promise.all(regionRequests).then((res) => {
            var cheapest = res
                .reduce((priv, cur) => (cur["SpotPrice"] < priv["SpotPrice"] ? cur : priv), {"SpotPrice": Infinity});
            resolve(cheapest);
        });
    });
};

var getCheapestInRegion = function (forRegion) {
    return new Promise(function(resolve, reject) {
        var AWS = require('aws-sdk');
        AWS.config.update({region: forRegion});
        var ec2 = new AWS.EC2();

        var startDate = new Date();

        var params = {
            ProductDescriptions: [
                "Linux/UNIX"
            ],
            StartTime: startDate
        };
        ec2.describeSpotPriceHistory(params, function(err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject();
            } else {
                var result = data["SpotPriceHistory"]
                    .filter ((b) => (b["InstanceType"].search(RWDRequest["instanceType"]) > -1))
                    .reduce ((priv, cur) => (cur["SpotPrice"] < priv["SpotPrice"] ? cur:priv), {"SpotPrice": Infinity});
                result["Region"] = forRegion;
                console.log(forRegion+" ready");
                resolve(result);
            }
        });
    });
};

//var getLastWeekMaxPrice

var getUbuntuAMIs = function (regs) {
    return new Promise(function(resolve, reject) {

        var request = require("request");

        request({
            url: "https://cloud-images.ubuntu.com/locator/ec2/releasesTable",
            json: true
        }, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                //console.log(body);
                body = body.replace(/],\s*]/, "]]"); //ubuntu cloud json bug
                var importedJSON = JSON.parse(body);
                var res = importedJSON["aaData"]
                    .map((a) => {
                        return {region: a[0], release: a[2], arch: a[3], type: a[4], ami: a[6]}
                    })
                    .filter((a) => regs.indexOf(a["region"]) > -1)
                    .filter((a) => a["release"].search(RWDRequest["ubuntuRelease"]) > -1)
                    .filter((a) => a["type"] === 'hvm:instance-store');
                res.forEach((a) => {
                    a["ami"] = a["ami"].replace(/<[^<]+>/g, "")
                });
                resolve(res);
            } else {
                reject();
            }
        })
    })
};

whenReady();

return;


    AWS.config.update({region: 'eu-central-1'});


var endDate = new Date();
var startDate = new Date();
startDate.setTime(endDate.getTime() - 7*24*60*60*1000);



