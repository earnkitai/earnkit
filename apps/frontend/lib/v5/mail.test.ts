import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_FROM, MailError, OWNER_EMAIL, ownerMail, resendMailer, type Mailer } from './mail';

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

const recorder = () => {
  const sent: Parameters<Mailer>[0][] = [];
  const mailer: Mailer = async (m) => {
    sent.push(m);
  };
  return { sent, mailer };
};

test('ownerMail without RESEND_API_KEY sends nothing', async () => {
  const { sent, mailer } = recorder();
  await ownerMail('Subject', 'Text', 'key-1', mailer);
  assert.equal(sent.length, 0);
});

test('ownerMail with a key mails the owner from EarnKit with the idempotency key', async () => {
  process.env.RESEND_API_KEY = 're_test';
  const { sent, mailer } = recorder();
  await ownerMail('Subject', 'Text', 'key-2', mailer);
  assert.deepEqual(sent, [{ to: OWNER_EMAIL, from: MAIL_FROM, subject: 'Subject', text: 'Text', idempotencyKey: 'key-2' }]);
  assert.equal(OWNER_EMAIL, 'j@earnkit.com');
  assert.equal(MAIL_FROM, 'EarnKit <digest@earnkit.com>');
});

test('a 500 from Resend throws MailError with the status', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 500 });
  }) as unknown as typeof fetch;
  const send = resendMailer('re_test', fakeFetch);
  await assert.rejects(
    send({ to: OWNER_EMAIL, from: MAIL_FROM, subject: 'S', text: 'T', idempotencyKey: 'k' }),
    (err: unknown) => err instanceof MailError && err.status === 500,
  );
  assert.equal(calls.length, 1);
  assert.equal((calls[0].init.headers as Record<string, string>)['Idempotency-Key'], 'k');
});

test('a network error throws MailError 0', async () => {
  const fakeFetch = (async () => {
    throw new Error('down');
  }) as unknown as typeof fetch;
  await assert.rejects(
    resendMailer('re_test', fakeFetch)({ to: OWNER_EMAIL, from: MAIL_FROM, subject: 'S', text: 'T', idempotencyKey: 'k' }),
    (err: unknown) => err instanceof MailError && err.status === 0,
  );
});
