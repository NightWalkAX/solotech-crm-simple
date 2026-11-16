// Contratos y Acuerdos: signed contracts/agreements with the scanned or signed file attached.
import fs from 'node:fs';
import path from 'node:path';
import { db, getRow, updateRow, DB_PATH } from './db.js';

const CONTRACTS_DIR = path.join(path.dirname(DB_PATH), 'contracts');
// Signed copies arrive as PDF, phone photos or the Word file: detect by magic bytes, not by name.
const TYPES = [
  { magic: '%PDF-', ext: 'pdf', mime: 'application/pdf' },
  { magic: '\x89PNG', ext: 'png', mime: 'image/png' },
  { magic: '\xff\xd8\xff', ext: 'jpg', mime: 'image/jpeg' },
  { magic: 'PK\x03\x04', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
];

export function listContracts({ client_id } = {}) {
  return db.prepare(`
    SELECT ct.*, c.company FROM contracts ct LEFT JOIN clients c ON c.id = ct.client_id
    ${client_id ? 'WHERE ct.client_id = @client_id' : ''}
        ORDER BY COALESCE(ct.signed_on, ct.created_at) DESC, ct.id DESC`).all(client_id ? { client_id: Number(client_id) } : {});
}

/** Attach the signed file. Old files are kept so an undo still points to a real file. */
export function attachContractFile(id, buf, name, actor) {
  if (!getRow('contracts', id)) throw new Error('contract not found');
  const t = buf?.length && TYPES.find(t => buf.subarray(0, t.magic.length).toString('latin1') === t.magic);
  if (!t) throw new Error('El archivo debe ser PDF, JPG, PNG o DOCX');
  if (buf.length > 30 * 1024 * 1024) throw new Error('Archivo demasiado grande (máx. 30 MB)');
  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  const file = path.join(CONTRACTS_DIR, `contract-${id}-${Date.now()}.${t.ext}`);
  fs.writeFileSync(file, buf);
  const file_name = path.basename(name || `contrato.${t.ext}`).replace(/[^\w.\- ()]/g, '_');
  return updateRow('contracts', id, { file_path: file, file_name, file_type: t.mime }, actor);
}
