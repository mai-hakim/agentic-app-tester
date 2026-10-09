// personas.js — who the agents pretend to be, and what they try to do.
// The personas are SIMULATIONS. They do not replace testing with real older adults or disabled people.
// All typed text is synthetic (made up). Agents never enter real personal data.

const PERSONAS = {
  'low-vision': {
    label: 'Low-vision user (Rosa, 78)',
    who: 'You are Rosa, 78. You have macular degeneration. Your phone is zoomed to 200%, you read slowly, small or faint text is very hard for you, and you get lost when things move off the screen.',
    browser: { zoom: 2 }
  },
  'hand-tremor': {
    label: 'Hand-tremor user (Walter, 81)',
    who: 'You are Walter, 81. You have an essential tremor. Your taps often land a few millimetres away from where you aim, so small buttons that sit close together are a problem. You are patient but tire quickly.',
    browser: { tremorPx: 9 }
  },
  'first-time': {
    label: 'First-time user (Grace, 70)',
    who: 'You are Grace, 70. You have never used this app or any app like it. You do not know any technical words. You only follow what the screen tells you, and you hesitate when something is unclear.',
    browser: {}
  },
  'scam-anxious': {
    label: 'Scam-anxious user (Harold, 74)',
    who: 'You are Harold, 74. Last year a phone scammer took money from you. You are suspicious of every letter and every app, you look for proof before you trust anything, and pressure makes you anxious.',
    browser: {}
  }
};

// Tasks per target app. Each persona gets one task that fits who they are.
const TASKS = {
  papershield: {
    match: /mai-hakim\.github\.io\/papershield|127\.0\.0\.1:\d+\/?$|localhost/,
    name: 'PaperShield (letter helper for older adults)',
    tasks: {
      'low-vision': 'Get past any welcome screens, open the sample letter called "Electric bill", and find out what you must do and by what date.',
      'hand-tremor': 'Get past any welcome screens, open the sample letter called "Benefits form", and find out whether you need to sign it.',
      'first-time': 'Start using the app from the very beginning. Get through the first screens and then try one sample letter. Find out what the app tells you to do.',
      'scam-anxious': 'Get past any welcome screens, open the sample letter called "Possible scam", find out if it is a scam, and find what the app says you should NOT do.'
    }
  },
  todomvc: {
    match: /demo\.playwright\.dev\/todomvc/,
    name: 'TodoMVC demo app (public test app published by the Playwright project)',
    tasks: {
      'low-vision': 'Add a to-do item that says "Call the pharmacy" and then check that it appears in the list.',
      'hand-tremor': 'Add two to-do items, "Buy milk" and "Pay water bill", then mark "Buy milk" as done.',
      'first-time': 'Work out how to add a to-do item, add "Visit Anna on Sunday", and then find a way to see only the items that are not done.',
      'scam-anxious': 'Add a to-do item "Check bank letter", mark it as done, then remove it from the list completely.'
    }
  }
};

function taskFor(url, persona) {
  const app = Object.values(TASKS).find(a => a.match.test(url));
  if (!app) return { appName: url, task: 'Explore the main features of this website and try to complete its main task.' };
  return { appName: app.name, task: app.tasks[persona] };
}

module.exports = { PERSONAS, TASKS, taskFor };
