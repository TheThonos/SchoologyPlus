// add tooltip to assignments
// Schoology uses a jQuery plugin called tipsy to do its native tooltips; we use the same for consistency
// https://github.com/MartinMartimeo/tipsy
// we use an ancient jquery version because our upstream library does

"use strict";

(async function () {
    // utility function
    function escapeForHtml(text) {
        let tempElem = document.createElement("span");
        $(tempElem).text(text);
        return tempElem.innerText;
    }

    /**
     * Wraps the given base string in syntax for an HTML element.
     * @param {string} baseString The HTML syntax string to wrap.
     * @param {string} wrapperTag The tag name of the wrapper element to use.
     * @param {Object} wrapperProps Properties to add to the wrapper element (they will be quoted). Escaping will not be performed; it is the caller's responsibility
     * @returns The given HTML syntax wrapped in a tag as specified.
     */
    function wrapHtml(baseString, wrapperTag, wrapperProps) {
        let resultString = "<" + wrapperTag;
        if (wrapperProps) {
            for (let prop in wrapperProps) {
                resultString += ` ${prop}="${wrapperProps[prop]}"`;
            }
        }
        resultString += ">";
        resultString += baseString;
        resultString += "</" + wrapperTag + ">";

        return resultString;
    }

    let gradeLoadHooks = [];
    let userId;

    // FIXME the container element in question (the list of assignments) can be recreated; we should handle this case

    // document tooltips
    // this is a hack to pass data back and forth between our page context script
    let documentTooltipDataHolder = document.createElement("div");
    documentTooltipDataHolder.id = "schoologyplus-material-tooltip-data-container";
    document.body.appendChild(documentTooltipDataHolder);

    $("#course-profile-materials tr.type-document").each(function (index, value) {
        let loadedTextHolder = document.createElement("span");
        loadedTextHolder.id = "tooltip-holder-" + value.id;
        documentTooltipDataHolder.appendChild(loadedTextHolder);
        loadedTextHolder.dataset.tooltipHtml = "Loading...";
        // title already has a tooltip (full filename), so we'll use the filesize instead
        $(value).find(".attachments-file-name .attachments-file-size").tipsy({ gravity: "w", html: true, title: () => loadedTextHolder.dataset.tooltipHtml });
    });

    // assignment tooltips
    $("#course-profile-materials tr.type-assignment").each((index, value) => {
        let loadedGrade = "Loading...";
        $(value).find(".item-title>a").tipsy({ gravity: "n", html: true, title: () => loadedGrade });

        let assignmentId = value.id.match(/\d+/)[0];

        gradeLoadHooks.push(function (grades) {
            let innerContent = "";

            if (!grades.grades[assignmentId]) {
                innerContent = "<span class=\"error-message\">No data found</span>";
            } else {
                let assignment = grades.grades[assignmentId];
                if (assignment.exception == 1) {
                    // excused
                    innerContent += "<span class=\"exception-excused\">Excused</span>";
                } else if (assignment.exception == 2) {
                    // incomplete
                    innerContent += "<span class=\"exception-incomplete\">Incomplete</span>";
                } else if (assignment.exception == 3) {
                    // missing
                    innerContent += "<span class=\"exception-missing\">Missing</span>";
                } else if (assignment.grade !== null) {
                    // normal grade status, has a grade
                    let gradeElem = wrapHtml(escapeForHtml((!assignment.max_points && assignment.grade >= 0 ? "+" : "") + assignment.grade), "span", { class: "tooltip-grade-numerator" });
                    if (assignment.max_points) {
                        gradeElem += " <span class=\"tooltip-horiz-divider\">/</span> ";
                        gradeElem += wrapHtml(escapeForHtml(assignment.max_points, "span", { class: "tooltip-grade-denominator" }));
                    } else {
                        gradeElem += " pts";
                    }
                    innerContent += wrapHtml(gradeElem, "span", { class: "tooltip-grade-info" });
                } else {
                    // normal grade status, ungraded by teacher
                    innerContent += "<span>No Grade</span>";
                }

                // strange denominator display circumstances
                if (assignment.exception || assignment.grade === null) {
                    let ptStr = !assignment.max_points ? "EC" : `${assignment.max_points} pts`;
                    innerContent += ` <span class=\"exception-max-pts-info\">(${ptStr})</span>`;
                }

                if (grades.gradeDrops[assignmentId]) {
                    // assignment dropped
                    innerContent = wrapHtml("Dropped", "span", { class: "tooltip-dropped-indicator" }) + " " + wrapHtml(innerContent, "span", { class: "tooltip-dropped-gradeinfo" });
                }

                innerContent = wrapHtml(innerContent, "p");

                let footerElements = [];
                if (assignment.category_id && grades.categories[assignment.category_id]) {
                    footerElements.push(wrapHtml(escapeForHtml(grades.categories[assignment.category_id].title), "span", { class: "tooltip-category" }));
                }
                if (grades.dropboxes[assignmentId]) {
                    let validSubmissions = grades.dropboxes[assignmentId].filter(x => !x.draft);
                    if (validSubmissions.length == 0) {
                        footerElements.push(wrapHtml("Not Submitted", "span", { class: "tooltip-not-submitted" }));
                    } else {
                        let submittedStatus = "Submitted";
                        if (validSubmissions[validSubmissions.length - 1].late) {
                            submittedStatus += " (Late)";
                            submittedStatus = wrapHtml(submittedStatus, "span", { class: "tooltip-submitted-late" });
                        } else {
                            submittedStatus = wrapHtml(submittedStatus, "span", { class: "tooltip-submitted-ontime" });
                        }
                        footerElements.push(submittedStatus);
                    }
                }

                if (footerElements.length > 0) {
                    innerContent += wrapHtml(footerElements.join("<span class=\"tooltip-horiz-divider\"> | </span>"), "p", { class: "tooltip-footer" });
                }
            }

            loadedGrade = wrapHtml(innerContent, "div", { class: "schoologyplus-tooltip assignment-tooltip" });
        });
    });

    let classId = window.location.pathname.match(/\/course\/(\d+)\/materials/)[1]; // ID of current course ("section"), as a string
    let myApiKeys = await getApiKeys();
    userId = myApiKeys[2];

    if (gradeLoadHooks.length > 0) {
        // load grade information for this class, call grade hooks

        // this object contains ALL grades from this Schoology account, "keyed" by annoying IDs
        // TODO Schoology API docs say this is paged, we should possible account for that? 
        let myGrades = await (await fetch(`https://api.schoology.com/v1/users/${userId}/grades`, {
            headers: createApiAuthenticationHeaders(myApiKeys)
        })).json();

        let thisClassGrades = myGrades.section.find(x => x.section_id == classId);

        // start building our return object, which will follow a nicer format
        let retObj = {};
        retObj.categories = {};
        retObj.grades = {};
        retObj.assignments = {};
        retObj.dropboxes = {};
        retObj.gradeDrops = {};

        // gradebook categories
        for (let gradeCategory of thisClassGrades.grading_category) {
            retObj.categories[gradeCategory.id] = gradeCategory;
            Object.freeze(gradeCategory);
        }

        Object.freeze(retObj.categories);

        // assignment grades
        // period is an array of object
        // period[x].assignment is an array of grade objects (the ones we want to enumerate)
        for (let assignment of thisClassGrades.period.reduce((accum, curr) => accum.concat(curr.assignment), [])) {
            retObj.grades[assignment.assignment_id] = assignment;
            Object.freeze(assignment);
        }

        Object.freeze(retObj.grades);

        let missingAssignmentCt = 0;
        let missingAssignmentErrorCt = 0;

        // assignments
        // need a separate API call
        let ourAssignments = await (await fetch(`https://api.schoology.com/v1/sections/${classId}/assignments`, {
            headers: createApiAuthenticationHeaders(myApiKeys)
        })).json();

        // for some reason (TODO why) that call doesn't always return everything
        // since we only use the assignments collection here (internally), no need to add the entire remainder off of grades
        // just if it's a strange grade status (exception or ungraded), we'll pull assignment details
        // also only obtain it if there's a material entry in the DOM for it, otherwise there's no point
        let missingAssignmentIds = Object.keys(retObj.grades).filter(x => ourAssignments.assignment.findIndex(y => y.id == x) < 0).filter(x => document.getElementById("n-" + x));
        for (let missingAssignment of missingAssignmentIds) {
            missingAssignmentCt++;
            let fetchRes = await fetch(`https://api.schoology.com/v1/sections/${classId}/assignments/${missingAssignment}`, {
                headers: createApiAuthenticationHeaders(myApiKeys)
            });
            if (fetchRes.ok) {
                ourAssignments.assignment.push(await fetchRes.json());
            } else {
                missingAssignmentErrorCt++;
            }
        }

        if (missingAssignmentCt > 0) {
            console.log(`Fetched ${missingAssignmentCt} assignment(s) (${missingAssignmentErrorCt} error(s)) missing from summary API call`);
        }

        for (let assignment of ourAssignments.assignment) {
            retObj.assignments[assignment.id] = assignment;
            Object.freeze(assignment);

            // string "0" or "1" from API
            // for performance reasons, don't fetch info for all dropboxes, just those without grade
            // assignments by default have dropboxes, but if teachers don't mean for them to be there, they end up being meaningless "Not Submitted"
            // thus, if the assignment has a normal grade, don't fetch submission status here
            // improves performance because it's one NETWORK API call PER ASSIGNMENT, and it blocks all tooltips until all assignments are done loading
            // especially visible in large classes
            let gradeInfo = retObj.grades[assignment.id];
            if (+assignment.allow_dropbox && (gradeInfo.grade === null || gradeInfo.exception)) {
                // "dropboxes," or places to submit documents via Schoology
                // another API call
                retObj.dropboxes[assignment.id] = (await (await fetch(`https://api.schoology.com/v1/sections/${classId}/submissions/${assignment.id}/${userId}`, {
                    headers: createApiAuthenticationHeaders(myApiKeys)
                })).json()).revision;
                Object.freeze(retObj.dropboxes[assignment.id]);
            }
        }

        Object.freeze(retObj.assignments);
        Object.freeze(retObj.dropboxes);

        // grade drops
        // unfortunately it doesn't look like the API returns grade drop status, so we have to scrape it from the gradebook
        let ourGradebookHtml = await (await fetch(`https://lms.lausd.net/course/${classId}/student_grades`)).text();
        let ourGradebookParser = new DOMParser();
        let ourGradebookDoc = ourGradebookParser.parseFromString(ourGradebookHtml, "text/html");

        let containerDiv = ourGradebookDoc.querySelector(".gradebook-course-grades");
        for (let gradeItemRow of containerDiv.querySelectorAll(".item-row")) {
            retObj.gradeDrops[gradeItemRow.dataset.id.match(/\d+/)[0]] = gradeItemRow.classList.contains("dropped");
        }

        Object.freeze(retObj.gradeDrops);
        Object.freeze(retObj);

        console.log("Assignment data loaded, creating tooltips");

        // call our event listeners
        for (let eventHook of gradeLoadHooks) {
            eventHook(retObj);
        }
    }

    // initialize pdfjs
    // FIXME this is an awful hack because we're trying to avoid webpack and pdfjs is a module
    let injectLib = document.createElement("script");
    injectLib.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.0.550/pdf.js";
    injectLib.type = "text/javascript";
    document.head.appendChild(injectLib);

    // do our API calls
    let documentInfoFromApi = {};
    // note that these CDN urls expire
    let documentUrlsFromApi = {};
    for (let value of document.querySelectorAll("#course-profile-materials tr.type-document")) {
        let materialId = value.id.match(/\d+/)[0];
        documentInfoFromApi[materialId] = (await (await fetch(`https://api.schoology.com/v1/sections/${classId}/documents/${materialId}`, {
            headers: createApiAuthenticationHeaders(myApiKeys)
        })).json());
    }

    for (let documentId in documentInfoFromApi) {
        // TODO this isn't the cleanest, not sure if this is accurate for all cases
        let fileData = documentInfoFromApi[documentId].attachments.files.file[0];
        if (fileData.converted_filemime == "application/pdf" && fileData.converted_download_path) {
            // get the URL of the doc we want
            // it's an unauthenticated CDN url that expires (experimentation), returned as a redirect
            // unfortunately we need permissions for the extra domain
            documentUrlsFromApi[documentId] = (await fetch(fileData.converted_download_path, {
                headers: createApiAuthenticationHeaders(myApiKeys)
            })).url;
        }
    }

    console.log("Injecting document tooltip handler...");
    let injectScript = document.createElement("script");
    let scriptText = (await (await fetch(chrome.runtime.getURL("js/materials.pdfhandler.js"))).text());
    // awful hack
    scriptText = scriptText.replace("/* SUBSTITUTE_API_DOCUMENT_INFO */", `let documentInfoFromApi = ${JSON.stringify(documentInfoFromApi)};`);
    scriptText = scriptText.replace("/* SUBSTITUTE_API_DOCUMENT_URLS */", `let documentUrlsFromApi = ${JSON.stringify(documentUrlsFromApi)};`);
    scriptText = scriptText.replace("/* SUBSTITUTE_HTML_BUILDER_UTIL */", `${escapeForHtml.toString()}\n${wrapHtml.toString()}`);
    injectScript.text = scriptText;
    document.head.appendChild(injectScript);
})();

