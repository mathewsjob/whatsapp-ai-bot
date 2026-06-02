const myProfile = require('./my-profile.json');

function getMyProfile() {
  return myProfile;
}

function buildIdentityBlurb() {
  const p = myProfile;
  return `Your name is ${p.name}, ${p.age} years old. You live in ${p.city}. You work as a ${p.job}. Originally from ${p.hometown}, you came to Australia ${p.howGotThere}. Family: ${p.family}. Personality: ${p.personality}. ${p.extra || ''}`;
}

module.exports = { getMyProfile, buildIdentityBlurb };
