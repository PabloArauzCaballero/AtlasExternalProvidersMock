"""Prueba el gate de salud del contenedor sin llamar a Coolify."""
import os
import pathlib
import subprocess
import tempfile

import yaml

workflow = yaml.safe_load(pathlib.Path('.github/workflows/deploy-dev.yml').read_text())
steps = workflow['jobs']['deploy']['steps']
names = [step.get('name') for step in steps]
assert names.index('Confirmar healthcheck interno del mock') > names.index('Deploy and wait for Coolify')
smoke = next(step['run'] for step in steps if step.get('name') == 'Confirmar healthcheck interno del mock')

with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    script = root / 'smoke.sh'
    script.write_text(smoke)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    curl = bin_dir / 'curl'
    curl.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
assert args[-1].endswith('/applications/app-1'), args[-1]
out = pathlib.Path(args[args.index('--output') + 1])
out.write_text(json.dumps({
    'status': os.environ['MOCK_APP_STATUS'],
    'git_commit_sha': os.environ['MOCK_APP_COMMIT'],
}))
print(os.environ['MOCK_HTTP_STATUS'], end='')
''')
    curl.chmod(0o755)

    for name, status, commit, http, expected in [
        ('healthy-exact-sha', 'running:healthy', 'a' * 40, '200', 0),
        ('old-commit', 'running:healthy', 'b' * 40, '200', 1),
        ('unhealthy', 'running:unhealthy', 'a' * 40, '200', 1),
        ('read-denied', 'running:healthy', 'a' * 40, '403', 1),
    ]:
        env = os.environ | {
            'PATH': f'{bin_dir}:{os.environ["PATH"]}',
            'COOLIFY_DEPLOY_WEBHOOK': 'http://host:8000/api/v1/deploy?uuid=app-1&force=false',
            'COOLIFY_API_TOKEN': 'test-token',
            'COOLIFY_API': 'http://host:8000/api/v1',
            'TARGET_SHA': 'a' * 40,
            'SMOKE_ATTEMPTS': '1',
            'MOCK_APP_STATUS': status,
            'MOCK_APP_COMMIT': commit,
            'MOCK_HTTP_STATUS': http,
        }
        result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True)
        assert result.returncode == expected, (name, result.stdout, result.stderr)
        print(f'{name}: exit={result.returncode}')
