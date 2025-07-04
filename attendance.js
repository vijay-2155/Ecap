const { chromium } = require('playwright');
const { JSDOM } = require('jsdom');

// Browser pool for better management
class BrowserPool {
    constructor() {
        this.browser = null;
        this.isInitializing = false;
    }

    async getBrowser() {
        if (!this.browser || !this.browser.isConnected()) {
            if (!this.isInitializing) {
                this.isInitializing = true;
                try {
                    this.browser = await chromium.launch({
                        headless: true,
                        args: ['--no-sandbox', '--disable-dev-shm-usage']
                    });
                } finally {
                    this.isInitializing = false;
                }
            } else {
                // Wait for initialization to complete
                while (this.isInitializing) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }
        return this.browser;
    }

    async closeBrowser() {
        if (this.browser && this.browser.isConnected()) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

const browserPool = new BrowserPool();

// Utility functions
function getCurrentDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
}

// Fixed calculation functions
function calculateSkippableHours(present, total) {
    const currentPercentage = (present / total) * 100;

    if (currentPercentage < 75) {
        return 0; // Can't skip any if already below threshold
    }

    let skippable = 0;
    let tempPresent = present;
    let tempTotal = total;

    // Calculate how many classes can be missed while staying >= 75%
    while (true) {
        tempTotal += 1; // Add one more class (assumed absent)
        const newPercentage = (tempPresent / tempTotal) * 100;

        if (newPercentage >= 75) {
            skippable += 1;
        } else {
            break;
        }
    }

    return skippable;
}

function calculateRequiredHours(present, total) {
    const currentPercentage = (present / total) * 100;

    // If there are no classes, don't calculate required hours
    if (total === 0) {
        return 0;
    }

    if (currentPercentage >= 75) {
        return 0; // Already above threshold
    }

    let required = 0;
    let tempPresent = present;
    let tempTotal = total;

    // Calculate how many classes need to be attended to reach 75%
    while (true) {
        tempPresent += 1; // Attend one more class
        tempTotal += 1;
        required += 1;

        const newPercentage = (tempPresent / tempTotal) * 100;

        if (newPercentage >= 75) {
            break;
        }
    }

    return required;
}

// Fixed login function
async function fetchAttendance(page, username, password) {
    try {
        await page.goto("https://webprosindia.com/vignanit/Default.aspx", {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        await page.fill("#txtId2", username);
        await page.fill("#txtPwd2", password);

        await page.evaluate(() => {
            if (typeof encryptJSText === 'function') {
                encryptJSText(2);
            }
            if (typeof setValue === 'function') {
                setValue(2);
            }
        });

        await page.click("#imgBtn2");

        // Wait for navigation or error
        await page.waitForLoadState("networkidle", { timeout: 15000 });

        // Check for login errors using Playwright's locator
        const errorElement = page.locator("#lblError2");
        const errorExists = await errorElement.count() > 0;

        if (errorExists) {
            const errorText = await errorElement.textContent();
            if (errorText && errorText.trim()) {
                return { success: false, message: "❌ Invalid Username or Password" };
            }
        }

        // Verify successful login by checking for expected elements
        const divScreens = page.locator("#divscreens");
        const divScreensExists = await divScreens.count() > 0;

        if (!divScreensExists) {
            // Check current URL to see if we're still on login page
            const currentUrl = page.url();
            if (currentUrl.includes('Default.aspx')) {
                return { success: false, message: "❌ Authentication Failed - Still on login page" };
            }
        }

        return { success: true, message: "✅ Logged in successfully" };

    } catch (error) {
        return { success: false, message: `❌ Login Error: ${error.message}` };
    }
}

// Get attendance data
async function getAttendanceData(page) {
    try {
        const academicUrl = "https://webprosindia.com/vignanit/Academics/studentacadamicregister.aspx?scrid=2";
        await page.goto(academicUrl, {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        const html = await page.content();
        return { html, message: "Data extracted successfully" };

    } catch (error) {
        return { html: null, message: `Failed to get attendance data: ${error.message}` };
    }
}

// Parse attendance data (unchanged)
function parseAttendanceData(html) {
    try {
        const dom = new JSDOM(html);
        const document = dom.window.document;

        // Get student ID
        const studentIdElement = document.querySelector('td.reportData2');
        const studentId = studentIdElement ? studentIdElement.textContent.trim().replace(':', '').trim() : 'Unknown';

        // Get dates and find today's column
        const headerRow = document.querySelector('tr.reportHeading2WithBackground');
        const dates = Array.from(headerRow.querySelectorAll('td')).map(td => td.textContent.trim());
        const today = getCurrentDate();
        const todayIndex = dates.findIndex(date => date.includes(today));

        // Process attendance data
        const rows = document.querySelectorAll('tr[title]');
        let totalPresent = 0;
        let totalClasses = 0;
        const todaysAttendance = [];
        const subjectAttendance = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td.cellBorder');
            if (cells.length >= 2) {
                const subject = cells[1].textContent.trim();
                const attendance = cells[cells.length - 2].textContent.trim();
                const percentage = cells[cells.length - 1].textContent.trim();

                // REMOVE this check: if (attendance !== "0/0") { ... }
                // Always process the subject, even if attendance is 0/0
                let present = 0, total = 0;
                if (attendance.includes('/')) {
                    [present, total] = attendance.split('/').map(Number);
                }
                totalPresent += present;
                totalClasses += total;

                // Process today's status
                if (todayIndex !== -1 && todayIndex < cells.length) {
                    const todayText = cells[todayIndex].textContent.trim();
                    const statuses = todayText.split(' ').filter(s => ['P', 'A'].includes(s));
                    if (statuses.length > 0) {
                        todaysAttendance.push(`${subject}: ${statuses.join(' ')}`);
                    }
                }

                // Always push subject attendance, even if 0/0
                subjectAttendance.push(`${subject.padEnd(20, '.')} ${attendance.padStart(7)} ${percentage}%`);
            }
        });

        // Calculate metrics
        const overallPercentage = totalClasses > 0 ? (totalPresent / totalClasses) * 100 : 0;
        const skippableHours = calculateSkippableHours(totalPresent, totalClasses);
        const requiredHours = calculateRequiredHours(totalPresent, totalClasses);

        const attendanceStatus = {
            above_threshold: overallPercentage >= 75,
            required_hours: requiredHours
        };

        return {
            student_id: studentId,
            total_present: totalPresent,
            total_classes: totalClasses,
            overall_percentage: parseFloat(overallPercentage.toFixed(2)),
            todays_attendance: todaysAttendance,
            subject_attendance: subjectAttendance,
            skippable_hours: skippableHours,
            attendance_status: attendanceStatus
        };

    } catch (error) {
        throw new Error(`Failed to parse attendance data: ${error.message}`);
    }
}

// Main attendance report function
async function getAttendanceReport(username, password) {
    const browser = await browserPool.getBrowser();
    let context = null;

    try {
        // Create new context for each request
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Set longer timeout for slower connections
        page.setDefaultTimeout(30000);

        // Login
        const loginResult = await fetchAttendance(page, username, password);
        if (!loginResult.success) {
            return { error: loginResult.message };
        }

        // Get attendance data
        const { html, message } = await getAttendanceData(page);

        if (!html) {
            return { error: "Failed to fetch attendance data" };
        }

        // Parse data
        const data = parseAttendanceData(html);

        return {
            student_id: data.student_id,
            total_present: data.total_present,
            total_classes: data.total_classes,
            overall_percentage: data.overall_percentage,
            todays_attendance: data.todays_attendance,
            subject_attendance: data.subject_attendance,
            skippable_hours: data.skippable_hours,
            attendance_status: data.attendance_status
        };

    } catch (error) {
        return { error: `Attendance Report Error: ${error.message}` };
    } finally {
        if (context) {
            await context.close();
        }
    }
}

// Cleanup function - call this when your application shuts down
async function cleanup() {
    await browserPool.closeBrowser();
}

// Graceful shutdown handlers
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('beforeExit', cleanup);

// Export the main function and cleanup
module.exports = {
    getAttendanceReport,
    cleanup
};