'use strict';

const { Contract } = require('fabric-contract-api');
const shim = require('fabric-shim');
const logger = shim.newLogger('prototype-tb');
const { ENROLLMENT_ID_ATTRIBUTE, ROLE_ATTRIBUTE, STUDENT_ROLE, TEACHER_ROLE, SECRETARIAT_ROLE, GRADE_TYPE, STUDENT_COURSE_KEY, COURSE_TYPE } = require('./constants');
const helper = require('./helper');
const { SAMPLE_COURSES, SAMPLE_GRADES } = require('./samples');

class PrototypeContract extends Contract {

    /**
     * List all grades for a student
     * The grades returned depend on the identity of the caller
     * @param {*} ctx context
     * @param {*} studentId id of the student
     */
    async ListGrades(ctx, studentId) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        const userId = ctx.clientIdentity.getAttributeValue(ENROLLMENT_ID_ATTRIBUTE);
        if (role === STUDENT_ROLE && studentId !== userId) {
            throw new Error(`Your role (${role}) does not allow you to access the grades of the student ${studentId}`);
        }
        logger.info(`Listing grades for user: ${userId}`);

        let grades = [];
        if (role === TEACHER_ROLE) {
            // return only grades for courses of the calling teacher
            let assets = await helper.QueryGradesByStudent(ctx, studentId);
            let allGrades = assets.map(a => a.Record);
            for (const grade of allGrades) {

                // get course
                let course = await helper.ReadAsset(ctx, grade.Course);

                // check course teacher
                if (course.Teacher === userId) {
                    grades.push(grade);
                }
            }
        }
        else {
            // return all student grades
            let assets = await helper.QueryGradesByStudent(ctx, studentId);
            grades = assets.map(a => a.Record);
        }

        logger.info(`Returning grades: ${JSON.stringify(grades)}`);
        return grades;
    }

    /**
     * Return a specific grade
     * @param {*} ctx context
     * @param {*} id the id of the grade to return
     */
    async GetGrade(ctx, id) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        const userId = ctx.clientIdentity.getAttributeValue(ENROLLMENT_ID_ATTRIBUTE);

        // check if grade exist
        const exists = await helper.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The grade ${id} does not exist`);
        }

        // get grade
        let grade = await helper.ReadAsset(ctx, id);

        // get course
        let course = await helper.ReadAsset(ctx, grade.Course);

        // security checks

        // teachers can only see grades for the courses they teach
        if (role === TEACHER_ROLE && course.Teacher !== userId) {
            throw new Error(`You are only allowed to see grades for courses you teach`);
        }
        // students can only see their grades
        else if (role === STUDENT_ROLE && grade.Student !== userId) {
            throw new Error(`You are not allowed to access the grades of other students`);
        }

        return grade;
    }

    /**
     * Add a grade to a student for a course
     * @param {*} ctx context
     * @param {*} id grade id
     * @param {*} studentId id of the student
     * @param {*} courseId id of the course
     * @param {*} value grade value (0.0 to 6.0)
     * @param {*} weight grade weight (0.1 to 1.0)
     * @param {*} type grade type (Labo, Test or Exam)
     */
    async AddGrade(ctx, id, studentId, courseId, value, weight, type) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        const userId = ctx.clientIdentity.getAttributeValue(ENROLLMENT_ID_ATTRIBUTE);
        if (role !== TEACHER_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if course exist
        const exists = await helper.AssetExists(ctx, courseId);
        if (!exists) {
            throw new Error(`The course ${courseId} does not exist`);
        }

        // get course
        let course = await helper.ReadAsset(ctx, courseId);

        // check if course is active
        if (!course.Active) {
            throw new Error(`You are not allowed to add grades for inactive courses`);
        }

        // check if user is teaching the course
        if (course.Teacher !== userId) {
            throw new Error(`You are only allowed to add grades for courses you teach`);
        }

        // check if student is registered in the course
        if (course.Students.indexOf(studentId) === -1) {
            throw new Error(`The student ${studentId} is not registered in the course ${courseId}`);
        }

        // add grade
		let grade = {
            ID: id,
            docType: GRADE_TYPE,
			Student: studentId,
            Course: courseId,
			Value: value,
			Weight: weight,
			Type: type
        };
        logger.info(`Adding grade: ${JSON.stringify(grade)}`);
        return await ctx.stub.putState(grade.ID, Buffer.from(JSON.stringify(grade)));
    }

    /**
     * Edit a grade
     * @param {*} ctx context
     * @param {*} id grade id
     * @param {*} value grade value (0.0 to 6.0)
     * @param {*} weight grade weight (0.1 to 1.0)
     * @param {*} type grade type (Labo, Test or Exam)
     */
    async UpdateGrade(ctx, id, value, weight, type) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        const userId = ctx.clientIdentity.getAttributeValue(ENROLLMENT_ID_ATTRIBUTE);
        if (role !== TEACHER_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if grade exist
        const exists = await helper.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The grade ${id} does not exist`);
        }

        // get current grade
        let grade = await helper.ReadAsset(ctx, id);

        // get course
        let course = await helper.ReadAsset(ctx, grade.Course);

        // check if course is active
        if (!course.Active) {
            throw new Error(`You are not allowed to edit grades for inactive courses`);
        }

        // check if user is teaching the course
        if (course.Teacher !== userId) {
            throw new Error(`You are only allowed to edit grades for courses you teach`);
        }

        // update grade
		let updatedGrade = {
            ID: id,
            docType: GRADE_TYPE,
			Student: grade.Student,
            Course: grade.Course,
			Value: value,
			Weight: weight,
			Type: type
        };
        logger.info(`Updating grade: ${JSON.stringify(updatedGrade)}`);
        return await ctx.stub.putState(id, Buffer.from(JSON.stringify(updatedGrade)));
	}

    /**
     * Check if a user is referenced in the ledger, as student or teacher
     * @param {*} ctx context
     * @param {*} userId the id of the student or teacher
     */
    async CheckIfUserIsReferenced(ctx, userId) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        if (role !== SECRETARIAT_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if user is a registered student
        let assetKeys = await helper.GetAssetKeysByPartialKey(ctx, STUDENT_COURSE_KEY, [userId]);
        if (assetKeys.length > 0) {
            logger.info(`Student references found: ${JSON.stringify(assetKeys)}`);
            return { isReferenced: true, referenceType: STUDENT_ROLE, references: assetKeys };
        }

        // check if user teaches a course
        let assets = await helper.QueryCoursesByTeacher(ctx, userId);
        if (assets.length > 0) {
            logger.info(`Teacher references found: ${JSON.stringify(assets)}`);
            return { isReferenced: true, referenceType: TEACHER_ROLE, references: assets.map(a => a.Key) };
        }

        return { isReferenced: false };
    }

    /**
     * List all courses
     * The courses returned depend on the identity of the caller
     * @param {*} ctx context
     */
    async ListCourses(ctx) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        const userId = ctx.clientIdentity.getAttributeValue(ENROLLMENT_ID_ATTRIBUTE);
        logger.info(`Listing courses for user: ${userId}`);

        let courses = [];
        if (role === SECRETARIAT_ROLE) {
            // return all courses
            let assets = await helper.QueryAssetsByDocType(ctx, COURSE_TYPE);
            courses = assets.map(a => a.Record);
        }
        else if (role === TEACHER_ROLE) {
            // return only courses having the calling user as teacher
            let assets = await helper.QueryCoursesByTeacher(ctx, userId);
            courses = assets.map(a => a.Record);
        }
        else {
            // return only courses having the calling user as student

            // get assets using the composite student to course key
            let assetKeys = await helper.GetAssetKeysByPartialKey(ctx, STUDENT_COURSE_KEY, [userId]);
            for (const assetKey of assetKeys) {

                // get the course key
                let objectType;
                let attributes;
                (
                    {objectType, attributes} = await ctx.stub.splitCompositeKey(assetKey)
                );
                let courseKey = attributes[1];

                // get the course
                let course = await helper.ReadAsset(ctx, courseKey);

                courses.push(course);
            }
        }

        logger.info(`Returning courses: ${JSON.stringify(courses)}`);
        return courses;
    }

    /**
     * Return a specific course
     * @param {*} ctx context
     * @param {*} id the id of the course to return
     */
    async GetCourse(ctx, id) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        const userId = ctx.clientIdentity.getAttributeValue(ENROLLMENT_ID_ATTRIBUTE);

        // check if course exist
        const exists = await helper.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The course ${id} does not exist`);
        }

        // get course
        let course = await helper.ReadAsset(ctx, id);

        // security checks

        // teachers can only see courses they teach
        if (role === TEACHER_ROLE && course.Teacher !== userId) {
            throw new Error(`You are only allowed to see courses you teach`);
        }
        // students can only see their courses
        else if (role === STUDENT_ROLE && course.Students.indexOf(userId) === -1) {
            throw new Error(`You are only allowed to access courses that you are registered to`);
        }

        return course;
    }

    /**
     * Add a new course
     * @param {*} ctx context
     * @param {*} acronym course acronym (e.g. MLG)
     * @param {*} name course name (e.g. Machine Learning)
     * @param {*} year year the course starts (e.g. 2020)
     * @param {*} teacher id of the teacher
     */
    async AddCourse(ctx, acronym, name, year, teacher) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        if (role !== SECRETARIAT_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // add course
        const course = {
            ID: acronym + '_' + year,
            docType: COURSE_TYPE,
            Acronym: acronym,
            Year: year,
            Name: name,
            Teacher: teacher,
            Students: [],
            Active: false,
        };
        logger.info(`Adding course: ${JSON.stringify(course)}`);
        return await ctx.stub.putState(course.ID, Buffer.from(JSON.stringify(course)));
    }

    /**
     * Enables a course
     * @param {*} ctx context
     * @param {*} id id of the course to enable
     */
    async EnableCourse(ctx, id) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        if (role !== SECRETARIAT_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if course exist
        const exists = await helper.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The course ${id} does not exist`);
        }

        // get current course
        let course = await helper.ReadAsset(ctx, id);

        // update course
        const updatedCourse = {
            ID: id,
            docType: COURSE_TYPE,
            Acronym: course.Acronym,
            Year: course.Year,
            Name: course.Name,
            Teacher: course.Teacher,
            Students: course.Students,
            Active: true,
        }
        logger.info(`Enabling course: ${JSON.stringify(updatedCourse)}`);
        return await ctx.stub.putState(id, Buffer.from(JSON.stringify(updatedCourse)));
    }

    /**
     * Disables a course
     * @param {*} ctx context
     * @param {*} id id of the course to enable
     */
    async DisableCourse(ctx, id) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        if (role !== SECRETARIAT_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if course exist
        const exists = await helper.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The course ${id} does not exist`);
        }

        // get current course
        let course = await helper.ReadAsset(ctx, id);

        // update course
        const updatedCourse = {
            ID: id,
            docType: COURSE_TYPE,
            Acronym: course.Acronym,
            Year: course.Year,
            Name: course.Name,
            Teacher: course.Teacher,
            Students: course.Students,
            Active: false,
        }
        logger.info(`Disabling course: ${JSON.stringify(updatedCourse)}`);
        return await ctx.stub.putState(id, Buffer.from(JSON.stringify(updatedCourse)));
    }

    /**
     * Register a student for a course
     * @param {*} ctx context
     * @param {*} courseId id of the course
     * @param {*} studentId id of the student to register
     */
    async RegisterStudent(ctx, courseId, studentId) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        if (role !== SECRETARIAT_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if course exist
        const exists = await helper.AssetExists(ctx, courseId);
        if (!exists) {
            throw new Error(`The course ${courseId} does not exist`);
        }

        // get current course
        let course = await helper.ReadAsset(ctx, courseId);

        // check if student is registered
        if (course.Students.indexOf(studentId) !== -1) {
            throw new Error(`The student ${studentId} is already registered`);
        }

        logger.info(`Registering student ${studentId} for course ${courseId}`);

        // update course
        let students = course.Students.slice();
        students.push(studentId);
        const updatedCourse = {
            ID: courseId,
            docType: COURSE_TYPE,
            Acronym: course.Acronym,
            Year: course.Year,
            Name: course.Name,
            Teacher: course.Teacher,
            Students: students,
            Active: course.Active,
        }
        logger.info(`Updating course: ${JSON.stringify(updatedCourse)}`);
        await ctx.stub.putState(courseId, Buffer.from(JSON.stringify(updatedCourse)));

        // add student to course link
        const compositeKey = await ctx.stub.createCompositeKey(STUDENT_COURSE_KEY, [studentId, courseId]);
        logger.info(`Adding composite key: ${compositeKey}`);
		await ctx.stub.putState(compositeKey, Buffer.from('\u0000'));
    }

    /**
     * Unregister a student from a course
     * @param {*} ctx context
     * @param {*} courseId id of the course
     * @param {*} studentId id of the student to unregister
     */
    async UnregisterStudent(ctx, courseId, studentId) {

        // check role
        const role = ctx.clientIdentity.getAttributeValue(ROLE_ATTRIBUTE);
        if (role !== SECRETARIAT_ROLE) {
            throw new Error(`Your role (${role}) does not allow you to perform this action`);
        }

        // check if course exist
        const exists = await helper.AssetExists(ctx, courseId);
        if (!exists) {
            throw new Error(`The course ${courseId} does not exist`);
        }

        // get current course
        let course = await helper.ReadAsset(ctx, courseId);

        // check if student is registered
        if (course.Students.indexOf(studentId) === -1) {
            throw new Error(`The student ${studentId} is not registered`);
        }

        logger.info(`Unregistering student ${studentId} from course ${courseId}`);

        // update course
        let students = course.Students.filter(s => s !== studentId);
        const updatedCourse = {
            ID: courseId,
            docType: COURSE_TYPE,
            Acronym: course.Acronym,
            Year: course.Year,
            Name: course.Name,
            Teacher: course.Teacher,
            Students: students,
            Active: course.Active,
        }
        logger.info(`Updating course: ${JSON.stringify(updatedCourse)}`);
        await ctx.stub.putState(courseId, Buffer.from(JSON.stringify(updatedCourse)));

        // delete student to course link
        const compositeKey = await ctx.stub.createCompositeKey(STUDENT_COURSE_KEY, [studentId, courseId]);
        logger.info(`Removing composite key: ${compositeKey}`);
		await helper.DeleteAsset(ctx, compositeKey);
    }

    // chaincode initialization with sample data
    async InitLedger(ctx) {

        // sample courses initialization
        for (const course of SAMPLE_COURSES) {

            // add course
            course.docType = COURSE_TYPE;
            await ctx.stub.putState(course.ID, Buffer.from(JSON.stringify(course)));

            // add student to course links
            for (const studentId of course.Students) {
                let compositeKey = await ctx.stub.createCompositeKey(STUDENT_COURSE_KEY, [studentId, course.ID]);
                await ctx.stub.putState(compositeKey, Buffer.from('\u0000'));
            }

            logger.info(`Course ${course.ID} initialized`);
        }

        // sample grades initialization
        for (const grade of SAMPLE_GRADES) {

            // add grade
            grade.docType = GRADE_TYPE;
            await ctx.stub.putState(grade.ID, Buffer.from(JSON.stringify(grade)));

            logger.info(`Grade ${grade.ID} initialized`);
        }
    }
}

module.exports = PrototypeContract;
