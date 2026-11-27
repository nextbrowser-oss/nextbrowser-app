const { parsePackage } = require('./store.cjs');
const base = '/v1/catalog/apps';
function catalogCommand(name, args, request) {
  const { id, version, file, publication } = args;
  if (name === 'mini_apps_community_list') {
    const after = args.after || '';
    if (after && !/^[a-z][a-z0-9-]{1,47}$/.test(after)) throw Error('Invalid catalog cursor.');
    return request(base + (after ? '?after=' + after : ''));
  }
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,47}$/.test(id)) throw Error('Invalid mini app ID.');
  const path = base + '/' + id;
  switch (name) {
    case 'mini_apps_reviews': {
      const offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid page.');
      return request(path + '/reviews?offset=' + offset);
    }
    case 'mini_apps_review_save':
      return request(path + '/reviews', {rating: args.rating, comment: args.comment});
    case 'mini_apps_community_file':
      if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version) || !/^(?:package|[0-7]\.png)$/.test(file)) throw Error('Invalid catalog file.');
      return request(path + '/' + version + '/' + file);
    case 'mini_apps_publish':
      if (parsePackage(publication?.package).id !== id) throw Error('Package ID changed.');
      return request(path, publication);
    default: throw Error('Unknown catalog command.');
  }
}
module.exports = { catalogCommand };
