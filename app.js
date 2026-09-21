const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const morgan = require('morgan');
const fu = require('express-fileupload');
const path = require('path');
const util = require('util');
const writeFile = util.promisify(fs.writeFile);
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');

//create app
const app = express();
app.set('view engine', 'ejs');

const rateLimiter = rateLimit({ //rate limiting for the overall website
    windowMs: 15 * 60 * 1000,
    max: 80,
    message: {
        error: 'Too many requests from this IP address',
        retryAfter: '5 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Too many requests from this IP, please try again in a few minutes',
            retryAfter: Math.round(req.rateLimit.resetTime / 1000)
        });
    }
});

const uploadLimiter = rateLimit({ //rate limiting for the vehicle upload part
    windowMs: 30 * 60 * 1000,
    max: 5,
    message: {
        error: 'Too many requests from this IP address',
        retryAfter: '15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Too many requests from this IP, please try again in a few minutes',
            retryAfter: Math.round(req.rateLimit.resetTime / 1000)
        });
    }
});

// app.use(rateLimiter);
// app.use('/upload', uploadLimiter);
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: "1mb", /* parameterLimit: 500 */ }));
app.use(morgan('dev'));
app.use(fu());

//connect to db
mongoose.connect("connection string to mongodb")
    .then(() => {
        app.listen(3333, () => {
            console.log("up and running !");
        });
    }).catch(error => console.log(error));

const scheme = new mongoose.Schema({ //make new car schema
    name: String,
    category: String,
    actualDate: Date,
}, { collection: 'cars' });

const CarScheme = mongoose.model('CarScheme', scheme);

let vehicleCategoryCount = {
    commercial: 0, compact: 0, coupe: 0, emergency: 0, military: 0, motorcycle: 0, muscle: 0, offroad: 0,
    openwheel: 0, plane: 0, sedan: 0, service: 0, sport: 0, sportclassic: 0, super: 0, suv: 0, other: 0
}

async function getCategoryLength() {
    Object.keys(vehicleCategoryCount).forEach(name => {
        name = name.toString();
        async function getToVehicleCategory() {
            await CarScheme.find({ category: name }).then(category => {
                vehicleCategoryCount[name] = category.length;
            }).catch(error => console.log(error));
        }
        getToVehicleCategory();
    });
}

// parse every category and looks if the url is requested
Object.keys(vehicleCategoryCount).forEach(category => {
    let categoryName = category.toString();
    app.get(`/${categoryName}`, async (req, res) => {
        let carList = [];
        getCategoryLength();
        await CarScheme.find({category: categoryName }).sort({ actualDate: -1 }).then(cars => cars.forEach(car => carList.push(car))).catch(error => console.log(error));
        res.render('preset/carBodyPreset.ejs', {title: categoryName, cars: carList, vehiclesCategoryLen: vehicleCategoryCount}); //serves the page with the vehicles from the requested category
        carList.splice(0);
    });
});

async function saveToDB(name, category, fileBuffer, fileName, imageBuffer, imageName) {
    let myID;
    await CarScheme.create({
        name: name,
        category: category,
        actualDate: Date.now(),
    }).then(object => {
            console.log("Successfully saved to db");
            myID = object.id;
    }).catch(error => console.log(error));
    await writeFile(`./public/images/${myID}.${imageName}`, imageBuffer, (error) => {
        if (!error) 
            console.log("File saved with success !");
    }).then(() => {
        fs.rename(`${path.join(__dirname)}/public/images/${myID}.${imageName}`, `${path.join(__dirname)}/public/images/${myID}.webp`, (error) => {
            if (error) {
                console.log(error);
            }
            else console.log("everything is ok !");
        })
    });

    await writeFile(`./files/${myID}.${fileName}`, fileBuffer, (error) => {
        if (!error) {
            console.log("File saved with success !");
        }
    }).then(() => console.log("Saved"));
}

app.post("/upload", (req, res) => {
    getCategoryLength();
    let ss = req.files;
    let mimetype = ss['vehicleImage'].mimetype;
    const extensions = ["image/png", "image/jpeg", "image/webp", "image/jpg"];
    if (extensions.includes(mimetype)) {
        let ext = mimetype.split("/");
        console.log(ext[1]);
        let inputBuffer = ss['vehicleImage']['data'];
        let outputName = ss['vehicleImage']['name'];
        //converting the image to the lightweight .webp formatt
        sharp(inputBuffer).toFile(`${outputName}.webp`, (error, info) => {
            if (!error) {
                console.log(info);
            }
            else {
                throw error;
            }
        });
        saveToDB(req.body['vehicleName'], req.body['categorie'], ss['vehicleFile']['data'], ss['vehicleFile']['name'], inputBuffer, outputName);
    }
    res.redirect(`/${req.body['categorie']}`);
});

app.get("/download/:id", async (req, res) => {
    let requestID = req.params.id;
    fs.readdir("files", { withFileTypes: true }, (error, files) => {
        if (error) {
            console.log("An error occured while reading the directory !");
        }
        else {
            files.forEach(file => {
                let name = file.name.split(".");
                file = name[1];
                if (name[0] == requestID) {
                    fileName = file.name;
                    fs.rename(`${path.join(__dirname)}/files/${name[0]}.${name[1]}.${name[2]}`, `${path.join(__dirname)}/files/${name[1]}.GTAVV`, (err) => {
                        if (err) console.log(err);
                        else {
                            res.download(`${path.join(__dirname)}/files/${file}.GTAVV`, (err) => {
                                if (err) {
                                    console.log(err);
                                }
                                else {
                                    fs.rename(`${path.join(__dirname)}/files/${file}.GTAVV`, `${path.join(__dirname)}/files/${name[0]}.${name[1]}.${name[2]}`, (error) => {
                                        if (error) console.log(error);
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }
    });
});

app.get("", (req, res) => { //redirect to home page
    res.redirect("/home");
});

app.get("/home", (req, res) => {
    getCategoryLength();
    res.render('home.ejs', { title: "HOME", vehiclesCategoryLen: vehicleCategoryCount });
});

app.get("/upload", (req, res) => {
    getCategoryLength();
    res.render("upload.ejs", { title: "UPLOAD", vehiclesCategoryLen: vehicleCategoryCount });
});

app.get("/privacy", (req, res) => {
    getCategoryLength();
    res.render("privacy.ejs", { title: "PRIVACY", vehiclesCategoryLen: vehicleCategoryCount });
});

app.get("/about", (req, res) => {
    getCategoryLength();
    res.render("about.ejs", { title: "ABOUT", vehiclesCategoryLen: vehicleCategoryCount });
});
