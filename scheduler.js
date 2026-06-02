const cron = require('node-cron');
const store = require('./store');
const { generateScheduledMessage } = require('./ai');

let sendFn = null;
const jobs = new Map();

function setSendFn(fn) {
  sendFn = fn;
}

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return { h, m };
}

function scheduleContact(phone) {
  if (jobs.has(phone)) {
    jobs.get(phone).forEach(j => j.destroy());
    jobs.delete(phone);
  }

  const profile = store.getProfile(phone);
  if (!profile || !profile.schedules) return;

  const contactJobs = [];

  for (const sched of profile.schedules) {
    if (!sched.enabled || !sched.time) continue;
    const { h, m } = parseTime(sched.time);
    const expr = `${m} ${h} * * *`;

    const job = cron.schedule(expr, async () => {
      try {
        const msg = await generateScheduledMessage(profile, sched.occasion);
        if (sendFn) await sendFn(phone, msg);
      } catch (e) {
        console.error('Scheduler error:', e.message);
      }
    });

    contactJobs.push(job);
  }

  if (contactJobs.length) jobs.set(phone, contactJobs);
}

function initScheduler() {
  const contacts = store.listContacts();
  for (const c of contacts) scheduleContact(c.phone);
  console.log(`[Scheduler] Initialized for ${contacts.length} contacts`);
}

module.exports = { initScheduler, scheduleContact, setSendFn };
