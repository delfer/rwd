#!/usr/bin/js
//depends on aws-sdk, request
//Request URL:https://cloud-images.ubuntu.com/locator/ec2/releasesTable?_=1490290382256

    var RWDRequest = {
        "region": "us-west-2",
        "instanceType": "(m3|c3|x1|r3|g2|f1|i3|d2).+",
        "ubuntuRelease": "16.04",
        "bidStrategy": "min" //min/mid/max //min = cur + 5% // mid ~ lwmax // max = lwmax + 5% // (where lwmax = last week max)
};

//Initial conf
var AWS = require('aws-sdk');
AWS.config.update({region: 'eu-central-1'});
var ec2 = new AWS.EC2();

var whenReady = function () {
    var cheapestOne = getRegions().then(getCheapest);
    var streams = []; //request parallel for Ubntu AMI's and AWS spot price history
    streams.push(cheapestOne.then(getUbuntuAMIs));
    streams.push(cheapestOne.then(setAwsRegion).then(getLastWeekMaxPrice).then(calculateBid));
    Promise.all(streams).then(makeBid);

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

var setAwsRegion = function (spot) {
    return new Promise(function(resolve, reject) {
        AWS.config.update({region: spot["Region"]});
        console.log ("Region: "+spot["Region"]);
        ec2 = new AWS.EC2();
        resolve(spot);
    })
};

var getLastWeekMaxPrice = function (spot) {
    return new Promise(function(resolve, reject) {
        var endDate = new Date();
        var startDate = new Date();
        startDate.setTime(endDate.getTime() - 7*24*60*60*1000);

        var params = {
            AvailabilityZone: spot["AvailabilityZone"],
            ProductDescriptions: [
                "Linux/UNIX"
            ],
            InstanceTypes: [
                spot["InstanceType"]
            ],
            StartTime: startDate,
            EndTime: endDate
        };
        ec2.describeSpotPriceHistory(params, function(err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject();
            } else {
                var result = data["SpotPriceHistory"]
                    .reduce((priv, cur) => (cur["SpotPrice"] > priv["SpotPrice"] ? cur : priv), {"SpotPrice": 0});
                spot["MaxSpotPrice"] = result["SpotPrice"];
                resolve(spot);
            }
        });

    })
};

var calculateBid = function (spot) {
    return new Promise(function(resolve, reject) {
        var bid;
        switch (RWDRequest["bidStrategy"]) {
            case "min":
                bid = spot["SpotPrice"]*1.05;
                if (bid < spot["MaxSpotPrice"]*0.9)
                    bid = spot["MaxSpotPrice"]*0.9;
                break;
            case "mid":
                bid = spot["MaxSpotPrice"];
                if (bid > spot["SpotPrice"]*1.2)
                    bid = spot["SpotPrice"]*1.2;
                break;
            case "max":
            default:
                bid = spot["MaxSpotPrice"]*1.05;
                break
        }
        spot["Bid"] = bid.toFixed(4);
        resolve(spot);
    })
};

var makeBid = function (spotAndAmi) {
    return new Promise(function(resolve, reject) {
        var spot = spotAndAmi[1];
        spot["AMI"] = spotAndAmi[0]["ami"];
        var params = {
            LaunchSpecification: {
                // IamInstanceProfile: {
                //     Arn: "arn:aws:iam::123456789012:instance-profile/my-iam-role"
                // },
                ImageId: spot["AMI"],
                InstanceType: spot["InstanceType"],
                KeyName: "test",
                // SecurityGroupIds: [
                //     "default"
                // ]
                // SubnetId: "subnet-1a2b3c4d"
            },
            SpotPrice: spot["Bid"],
            Type: "one-time"
        };
        console.log (params);
        ec2.requestSpotInstances(params, function(err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else     console.log(data);           // successful response
            /*
             data = {
             }
             */
        });
    })
}

var getUbuntuAMIs = function (spot) {
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
                    .filter((a) => spot["Region"] === a["region"])
                    .filter((a) => a["release"].search(RWDRequest["ubuntuRelease"]) > -1)
                    .filter((a) => a["type"] === 'hvm:instance-store')
                    .filter((a) => a["arch"] === 'amd64');
                res.forEach((a) => {
                    a["ami"] = a["ami"].replace(/<[^<]+>/g, ""); //removing html tags
                });
                if (res.length > 1) {
                    console.log("Found Ubuntu AMI's > 1");
                    reject();
                } else if (res.length < 1) {
                    console.log("Not found Ubuntu AMI");
                    reject();
                } else {
                    resolve(res[0]);
                }
            } else {
                reject();
            }
        })
    })
};

whenReady();

return;






