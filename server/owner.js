// Who uses this CRM, for the AI prompts: from Integraciones → Emisor y firma (settings.issuer).
import { getSetting } from './db.js';

export function owner() {
  const i = getSetting('issuer', {});
  const name = i.signer_name?.trim() || '';
  const business = i.name?.trim() || '';
  return {
    name: name || 'the owner',                   // "the owner", or "the owner" until it is filled in
    short: name.split(/\s+/)[0] || 'Owner',      // label for their own messages in transcripts
    business: business || 'the business',
    who: [name || 'the owner', business && `(${business})`].filter(Boolean).join(' '),
  };
}
