export function getQueryParam(url, param) {
  const regex = new RegExp('[?&]' + param + '(=([^&#]*)|&|#|$)'),
    results = regex.exec(url);
  if (!results) {
    return null;
  }
  if (!results[2]) {
    return '';
  }
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

export function createAsociateCardEvent(otc, cardModulePubKey) {
  const body = {
    otc,
  };

  return {
    kind: 21111,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', cardModulePubKey],
      ['t', 'card-associate-request'],
    ],
    content: JSON.stringify(body),
  };
}

module.exports = {
  getQueryParam,
  createInitializeCardEvent,
  createAsociateCardEvent,
};
