/**
 * Isolated ephemeral repository sandbox builder for Agent 10 QA tests.
 *
 * Copies mutable JSON/Markdown files into os.tmpdir() while symlinking (or
 * selectively copying) scan assets so tests never mutate the Git worktree.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, hydrateFixturePlaceholders } from './contract_adapter.mjs';
import { stampClaimLedgerFingerprints, validateClaims } from '../../scripts/validate-claims.mjs';

export function createIsolatedRepoSandbox({
  caseSlugs = ['hoodlum', 'gimmick', 'ballyhoo'],
  copyExistingClaims = false,
  symlinkScans = true,
  copyScanSlugs = [],
  copyScripts = false,
} = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dragnet-qa-'));

  fs.mkdirSync(path.join(tmpRoot, 'src', 'content', 'cases'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public', 'ledgers'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public', 'claims'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'public', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'research-system'), { recursive: true });

  for (const slug of caseSlugs) {
    const srcCase = path.join(REPO_ROOT, 'src', 'content', 'cases', `${slug}.md`);
    const srcLedger = path.join(REPO_ROOT, 'public', 'ledgers', `${slug}.json`);
    const srcClaim = path.join(REPO_ROOT, 'public', 'claims', `${slug}.json`);
    if (fs.existsSync(srcCase)) {
      fs.copyFileSync(srcCase, path.join(tmpRoot, 'src', 'content', 'cases', `${slug}.md`));
    }
    if (fs.existsSync(srcLedger)) {
      fs.copyFileSync(srcLedger, path.join(tmpRoot, 'public', 'ledgers', `${slug}.json`));
    }
    if (copyExistingClaims && fs.existsSync(srcClaim)) {
      fs.copyFileSync(srcClaim, path.join(tmpRoot, 'public', 'claims', `${slug}.json`));
    }
  }

  const openQ = path.join(REPO_ROOT, 'public', 'data', 'open-questions.json');
  if (fs.existsSync(openQ)) {
    fs.copyFileSync(openQ, path.join(tmpRoot, 'public', 'data', 'open-questions.json'));
  }

  for (const meta of ['package.json', 'CITATION.cff', 'LICENSE', 'CHANGELOG_CORRECTIONS.md', 'astro.config.mjs']) {
    const srcMeta = path.join(REPO_ROOT, meta);
    if (fs.existsSync(srcMeta)) {
      fs.copyFileSync(srcMeta, path.join(tmpRoot, meta));
    }
  }

  if (copyScanSlugs.length > 0) {
    // Copy specific scan folders so scan-byte mutation tests never touch repo files
    fs.mkdirSync(path.join(tmpRoot, 'public', 'scans'), { recursive: true });
    for (const slug of copyScanSlugs) {
      const srcScanDir = path.join(REPO_ROOT, 'public', 'scans', slug);
      const dstScanDir = path.join(tmpRoot, 'public', 'scans', slug);
      if (fs.existsSync(srcScanDir)) {
        fs.cpSync(srcScanDir, dstScanDir, { recursive: true });
      }
    }
  } else if (symlinkScans && fs.existsSync(path.join(REPO_ROOT, 'public', 'scans'))) {
    fs.symlinkSync(
      path.join(REPO_ROOT, 'public', 'scans'),
      path.join(tmpRoot, 'public', 'scans'),
      'dir'
    );
  } else {
    fs.mkdirSync(path.join(tmpRoot, 'public', 'scans'), { recursive: true });
  }

  if (fs.existsSync(path.join(REPO_ROOT, 'schemas'))) {
    fs.symlinkSync(path.join(REPO_ROOT, 'schemas'), path.join(tmpRoot, 'schemas'), 'dir');
  }
  if (fs.existsSync(path.join(REPO_ROOT, 'docs'))) {
    fs.symlinkSync(path.join(REPO_ROOT, 'docs'), path.join(tmpRoot, 'docs'), 'dir');
  }

  if (copyScripts) {
    fs.mkdirSync(path.join(tmpRoot, 'scripts'), { recursive: true });
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'scripts'))) {
      const s = path.join(REPO_ROOT, 'scripts', entry);
      if (fs.statSync(s).isFile()) {
        fs.copyFileSync(s, path.join(tmpRoot, 'scripts', entry));
      }
    }
  }

  function writeFixtureJson(relTargetPath, fixtureFilePath, { autoStamp = false } = {}) {
    const raw = fs.readFileSync(fixtureFilePath, 'utf-8');
    const hydrated = hydrateFixturePlaceholders(raw);
    const parsed = JSON.parse(hydrated);
    const meta = parsed._qa_meta || {};
    delete parsed._qa_meta;
    const dest = path.join(tmpRoot, relTargetPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');

    if (autoStamp || meta.stamp_before_validate === true) {
      stampClaimLedgerFingerprints([dest], {
        rootDir: tmpRoot,
        publicDir: path.join(tmpRoot, 'public'),
        ledgersDir: path.join(tmpRoot, 'public', 'ledgers'),
        claimsDir: path.join(tmpRoot, 'public', 'claims'),
      });
    }
    return { dest, meta };
  }

  function validateSandboxClaims(extraOpts = {}) {
    return validateClaims({
      rootDir: tmpRoot,
      publicDir: path.join(tmpRoot, 'public'),
      ledgersDir: path.join(tmpRoot, 'public', 'ledgers'),
      casesDir: path.join(tmpRoot, 'src', 'content', 'cases'),
      claimsDir: path.join(tmpRoot, 'public', 'claims'),
      openQuestionsPath: path.join(tmpRoot, 'public', 'data', 'open-questions.json'),
      ...extraOpts,
    });
  }

  function stampSandboxClaims(targetPaths = [path.join(tmpRoot, 'public', 'claims')]) {
    return stampClaimLedgerFingerprints(targetPaths, {
      rootDir: tmpRoot,
      publicDir: path.join(tmpRoot, 'public'),
      ledgersDir: path.join(tmpRoot, 'public', 'ledgers'),
      claimsDir: path.join(tmpRoot, 'public', 'claims'),
    });
  }

  function cleanup() {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  return {
    tmpRoot,
    writeFixtureJson,
    validateSandboxClaims,
    stampSandboxClaims,
    cleanup,
  };
}

export function runPythonScript(scriptPath, args = [], cwd = REPO_ROOT) {
  const res = spawnSync('python3', [scriptPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}
