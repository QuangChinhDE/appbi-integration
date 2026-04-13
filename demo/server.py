"""
IntegrationHub – Local proxy server
Chạy: python server.py
Truy cập: http://localhost:5000
"""

import os
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='.')
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ── Serve frontend ──────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


# ── Proxy: Request – Group List ─────────────────────────────────
@app.route('/proxy/request/group/list', methods=['POST'])
def proxy_request_group_list():
    domain          = request.form.get('domain', '').strip()
    access_token_v2 = request.form.get('access_token_v2', '').strip()
    page            = request.form.get('page', '1').strip()

    if not domain:
        return jsonify({'error': 'Missing domain'}), 400
    if not access_token_v2:
        return jsonify({'error': 'Missing access_token_v2'}), 400

    url = f'https://request.{domain}/extapi/v1/group/list'

    try:
        resp = requests.post(
            url,
            data={
                'access_token_v2': access_token_v2,
                'page': page,
            },
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=15,
            verify=True,
        )
        try:
            data = resp.json()
        except ValueError:
            return jsonify({'error': f'Server trả về nội dung không phải JSON. HTTP {resp.status_code}'}), 502

        return jsonify(data), resp.status_code

    except requests.exceptions.SSLError as e:
        return jsonify({'error': f'Lỗi SSL: {str(e)}'}), 502
    except requests.exceptions.ConnectionError as e:
        return jsonify({'error': f'Không thể kết nối tới request.{domain}: {str(e)}'}), 502
    except requests.exceptions.Timeout:
        return jsonify({'error': f'Request tới request.{domain} bị timeout (>15s)'}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({'error': str(e)}), 502


if __name__ == '__main__':
    print()
    print('  ┌─────────────────────────────────────────────┐')
    print('  │   IntegrationHub Proxy Server               │')
    print('  │   http://localhost:5000                     │')
    print('  └─────────────────────────────────────────────┘')
    print()
    app.run(host='0.0.0.0', port=5000, debug=False)
