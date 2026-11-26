#!/usr/bin/env bash
# Loads the built package on the Node version in PATH, as ESM and CJS, through every subpath.
set -euo pipefail
echo "node $(node --version)"
node --input-type=module -e "import { createIGDB } from './dist/index.js'; const q = createIGDB({ clientId: 'a', clientSecret: 'b' }).games.select('name').where((g) => g.rating.gt(1)); if (q.toApicalypse() !== 'fields name; where rating > 1;') process.exit(1)"
node -e "const { createIGDB } = require('./dist/index.cjs'); createIGDB({ clientId: 'a', clientSecret: 'b' }).games.limit(1).toApicalypse()"
node --input-type=module -e "import { redisCache } from 'igdb-kit/redis'; if (typeof redisCache !== 'function') process.exit(1)"
node -e "const { redisLimiter } = require('igdb-kit/redis'); if (typeof redisLimiter !== 'function') process.exit(1)"
node --input-type=module -e "import { webhookHandler } from 'igdb-kit/webhooks'; if (typeof webhookHandler !== 'function') process.exit(1)"
node -e "const { parseWebhook } = require('igdb-kit/webhooks'); if (typeof parseWebhook !== 'function') process.exit(1)"
node --input-type=module -e "import { igdbProxy } from 'igdb-kit/proxy'; import { createIGDB } from 'igdb-kit'; const h = igdbProxy({ igdb: createIGDB({ clientId: 'a', clientSecret: 'b' }), endpoints: ['games'] }); const r = await h(new Request('http://x/api/igdb/genres', { method: 'POST', body: 'fields name;' })); if (r.status !== 404) process.exit(1)"
node -e "const { igdbProxy } = require('igdb-kit/proxy'); const { createIGDB } = require('igdb-kit'); igdbProxy({ igdb: createIGDB({ clientId: 'a', clientSecret: 'b' }) })"
node --input-type=module -e "import { releaseDate } from 'igdb-kit/game'; if (releaseDate({ release_dates: [{ id: 1, date: 0, date_format: 0, release_region: 8, platform: 6 }] }).year !== 1970) process.exit(1)"
node -e "const { formatPlaytime } = require('igdb-kit/game'); if (formatPlaytime(7200, { locale: 'en-US' }) !== '2 hr') process.exit(1)"
node --input-type=module -e "import { videoLinks } from 'igdb-kit/game'; import { imageSrcSet } from 'igdb-kit'; if (videoLinks({ videos: [{ id: 1, video_id: 'D1mDo1CEMuE', name: 'Launch Trailer' }] })[0].kind !== 'trailer' || !imageSrcSet('co1wyy', 'thumb').endsWith(' 2x')) process.exit(1)"
node -e "const { eventTime, countryName } = require('igdb-kit/game'); if (eventTime({ start_time: 0, time_zone: 'PST' }, { locale: 'en' }).timeZone !== 'America/Los_Angeles' || countryName(250, 'en') !== 'France') process.exit(1)"
node --input-type=module -e "import { endpointSchema, jsonSchema } from 'igdb-kit/schema'; if (endpointSchema('games').fields.find((f) => f.name === 'platforms').endpoint !== 'platforms' || jsonSchema('games').required[0] !== 'id') process.exit(1)"
node -e "const { endpointSchema } = require('igdb-kit/schema'); if (!endpointSchema('games').linkedFrom.some((l) => l.endpoint === 'release_dates' && l.field === 'game')) process.exit(1)"
node -e "const { createLabels } = require('igdb-kit/i18n'); const { ja } = require('igdb-kit/i18n/ja'); const { label } = createLabels([ja]); if (label('genres', 12, 'ja-JP') !== ja.labels.genres[12] || label('genres', 12, 'en') !== 'Role-playing (RPG)') process.exit(1)"

