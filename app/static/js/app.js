// ==============================================================================
// SuiriMap - Waterway & Farmland Visualization Logic
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 地図の初期座標: 岡山市東区瀬戸町万富・鍛冶屋付近
    const initialLocation = [34.759, 134.075];
    const initialZoom = 16;

    let map;
    let waterwaysLayerGroup;
    let facilitiesLayerGroup;
    let draftLayerGroup;

    // レイヤーオブジェクト
    let stdTileLayer;
    let orthoTileLayer;

    // データステート
    let waterwaysData = { type: "FeatureCollection", features: [] }; // 水路及び施設を格納する統合GeoJSON
    let currentMode = 'view';   // 'view', 'add', 'add-facility', 'delete'
    let pendingWaterway = null; // 新規追加中の一時水路オブジェクト
    
    // 選択状態
    let selectedType = null;    // 'farmland', 'waterway', 'facility'
    let selectedId = null;      // 選択中要素のID
    let selectedWaterwayPolyline = null; // 強調表示対象的のLeaflet Polylineレイヤー

    // 水路の新規描画用の一時座標リスト
    let draftLatLngs = [];
    let draftPolyline = null;
    let draftMarkers = [];

    // DOM Elements
    const btnLayerStd = document.getElementById('btn-layer-std');
    const btnLayerOrtho = document.getElementById('btn-layer-ortho');

    const btnModeView = document.getElementById('btn-mode-view');
    const btnModeAdd = document.getElementById('btn-mode-add');
    const btnModeAddFacility = document.getElementById('btn-mode-add-facility');
    const modeHint = document.getElementById('mode-hint');

    const btnSaveWaterways = document.getElementById('btn-save-waterways');
    const btnClearDraft = document.getElementById('btn-clear-draft');

    const systemList = document.getElementById('system-list');

    // 情報カード
    const waterwayInfoCard = document.getElementById('waterway-info-card');
    const facilityInfoCard = document.getElementById('facility-info-card');
    const infoEmpty = document.getElementById('info-empty');

    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');

    // 1. 地図の初期化
    const initMap = () => {
        // 地理院標準地図タイル
        stdTileLayer = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>"
        });

        // 地理院空中写真（航空写真）タイル
        orthoTileLayer = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg', {
            maxZoom: 18,
            attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>国土地理院</a>"
        });

        // マップ作成（初期位置は後述のstartAppにて段階的に上書きされます）
        map = L.map('map', {
            center: [36.0, 137.5], // 仮の初期表示（日本全体）
            zoom: 5,
            layers: [orthoTileLayer] // デフォルトは航空写真
        });

        // ズームコントロールを右上に移動（見やすさ向上のため）
        map.zoomControl.setPosition('topright');

        // レイヤーグループの初期化
        waterwaysLayerGroup = L.layerGroup().addTo(map);
        facilitiesLayerGroup = L.layerGroup().addTo(map);
        draftLayerGroup = L.layerGroup().addTo(map);

        // 地図クリックイベント（水路追加用）
        map.on('click', handleMapClick);
        map.on('dblclick', handleMapDblClick);

        // 地図右クリックイベント（水路プロットの1点戻す/Undo用）
        map.on('contextmenu', (e) => {
            if (currentMode === 'add' && draftLatLngs.length > 0) {
                L.DomEvent.preventDefault(e); // ブラウザデフォルトの右クリックメニューを防止
                undoLastDraftPoint();
            }
        });

        // 地図移動・ズーム終了時に現在位置を localStorage に記憶（Googleマップ風機能）
        map.on('moveend', () => {
            const center = map.getCenter();
            const zoom = map.getZoom();
            localStorage.setItem('suiri_map_last_location', JSON.stringify({
                lat: center.lat,
                lng: center.lng,
                zoom: zoom
            }));
        });
    };

    // 2. レイヤー切り替え
    btnLayerStd.addEventListener('click', () => {
        btnLayerStd.classList.add('active');
        btnLayerOrtho.classList.remove('active');
        map.addLayer(stdTileLayer);
        map.removeLayer(orthoTileLayer);
    });

    btnLayerOrtho.addEventListener('click', () => {
        btnLayerOrtho.classList.add('active');
        btnLayerStd.classList.remove('active');
        map.addLayer(orthoTileLayer);
        map.removeLayer(stdTileLayer);
    });



    // 3. モード切り替え
    const setMode = (mode) => {
        currentMode = mode;
        
        // アクティブクラスの調整
        btnModeView.classList.remove('active');
        btnModeAdd.classList.remove('active');
        btnModeAddFacility.classList.remove('active');

        // 下書き状態のクリア（モード変更時）
        clearDraft();
        pendingWaterway = null; // 新規追加中の一時データをリセット

        // 選択状態と詳細表示パネルのクリア（全水路を通常表示に戻す）
        resetInfoPanel();

        if (mode === 'view') {
            btnModeView.classList.add('active');
            modeHint.innerText = "閲覧モード：水路や施設をクリックすると詳細情報を表示します";
            modeHint.style.borderLeftColor = "var(--accent-blue)";
        } else if (mode === 'add') {
            btnModeAdd.classList.add('active');
            modeHint.innerText = "水路の追加：地図をクリックして水路をプロットし、ダブルクリックで確定します";
            modeHint.style.borderLeftColor = "var(--accent-green)";
        } else if (mode === 'add-facility') {
            btnModeAddFacility.classList.add('active');
            modeHint.innerText = "施設の追加：地図上をクリックした場所に、新しい施設（取水口や水門など）をプロットします";
            modeHint.style.borderLeftColor = "#f59e0b";
        }
    };

    btnModeView.addEventListener('click', () => setMode('view'));
    btnModeAdd.addEventListener('click', () => setMode('add'));
    btnModeAddFacility.addEventListener('click', () => setMode('add-facility'));

    // 4. トースト表示
    const showToast = (message, isSuccess = true) => {
        toastMessage.innerText = message;
        toast.style.background = isSuccess ? "#10b981" : "#ef4444";
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    };



    // 6. 水路及び施設データのロードと描画
    const loadWaterways = async () => {
        try {
            const response = await fetch('/api/waterways');
            if (!response.ok) throw new Error("水路データの取得に失敗しました。");
            waterwaysData = await response.json();
            
            drawWaterways();
            drawFacilities();
            updateSystemList();
        } catch (error) {
            console.error("Waterway load error:", error);
            showToast("水路データのロードに失敗しました。", false);
        }
    };

    // 16色のカラーコード定義
    const waterwayColors = {
        'blue-dark': '#1d4ed8',   'blue-light': '#93c5fd',
        'green-dark': '#047857',  'green-light': '#a7f3d0',
        'red-dark': '#b91c1c',    'red-light': '#fca5a5',
        'brown-dark': '#7c2d12',  'brown-light': '#fed7aa',
        'yellow-dark': '#d97706', 'yellow-light': '#fef08a',
        'purple-dark': '#6d28d9', 'purple-light': '#c4b5fd',
        'pink-dark': '#db2777',   'pink-light': '#fbcfe8',
        'black-dark': '#1f2937',  'black-light': '#9ca3af'
    };

    // 5. 水路のスタイル定義
    const getWaterwayStyle = (weightType, colorKey, isSelected = false) => {
        const color = waterwayColors[colorKey] || '#1d4ed8'; // デフォルトは青（濃）
        const isBranch = weightType === 'branch';
        
        let style = {
            color: color,
            weight: isBranch ? 3 : 5, // 支線なら3px、本線なら5px
            dashArray: isBranch ? '8, 8' : '12, 12' // 太さにより破線パターンも微調整
        };

        if (isSelected) {
            style.weight += 4; // 選択中は +4px 強調
        }
        return style;
    };

    const drawWaterways = () => {
        waterwaysLayerGroup.clearLayers();
        if (!waterwaysData || !waterwaysData.features) return;

        waterwaysData.features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates;
                const latlngs = coords.map(c => [c[1], c[0]]);

                const id = feature.properties.id;
                let weightType = feature.properties.lineWeight;
                let colorKey = feature.properties.lineColor;

                // 互換性フォールバック（旧typeからの移行）
                if (!weightType || !colorKey) {
                    const oldType = feature.properties.type || 'main';
                    if (oldType === 'drain') {
                        weightType = 'branch';
                        colorKey = 'green-dark';
                    } else if (oldType === 'branch') {
                        weightType = 'branch';
                        colorKey = 'blue-light';
                    } else {
                        weightType = 'main';
                        colorKey = 'blue-dark';
                    }
                    feature.properties.lineWeight = weightType;
                    feature.properties.lineColor = colorKey;
                }
                
                const isSelected = (selectedType === 'waterway' && selectedId === id);
                const style = getWaterwayStyle(weightType, colorKey, isSelected);

                // 水が流れる破線アニメーションをCSSで行うため、classNameに 'flow-line' を付与
                const polyline = L.polyline(latlngs, {
                    color: style.color,
                    weight: style.weight,
                    dashArray: style.dashArray,
                    className: 'flow-line',
                    opacity: 0.95
                });

                if (isSelected) {
                    selectedWaterwayPolyline = polyline;
                }

                // クリックイベント
                polyline.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleWaterwaySelect(feature, polyline);
                });

                polyline.bindTooltip(`系統: ${feature.properties.sysNo || ''} ${feature.properties.name || '未設定'}`, {
                    sticky: true
                });

                waterwaysLayerGroup.addLayer(polyline);
            }
        });
    };

    const handleWaterwaySelect = (feature, polyline) => {
        if (currentMode === 'view') {
            showWaterwayInfo(feature);
            highlightWaterway(feature.properties.id, polyline);
        }
    };

    // 太さに応じた色の選択肢の動的更新
    const updateColorOptions = (weightType, currentColorKey) => {
        const colorSelect = document.getElementById('waterway-color');
        if (!colorSelect) return;
        colorSelect.innerHTML = '';

        const colors = [
            { name: '青', dark: 'blue-dark', light: 'blue-light' },
            { name: '緑', dark: 'green-dark', light: 'green-light' },
            { name: '赤', dark: 'red-dark', light: 'red-light' },
            { name: '茶色', dark: 'brown-dark', light: 'brown-light' },
            { name: '黄色', dark: 'yellow-dark', light: 'yellow-light' },
            { name: '紫', dark: 'purple-dark', light: 'purple-light' },
            { name: 'ピンク', dark: 'pink-dark', light: 'pink-light' },
            { name: '黒', dark: 'black-dark', light: 'black-light' }
        ];

        const isBranch = (weightType === 'branch');

        colors.forEach(c => {
            const option = document.createElement('option');
            option.value = isBranch ? c.light : c.dark;
            option.innerText = c.name;
            if (option.value === currentColorKey) {
                option.selected = true;
            }
            colorSelect.appendChild(option);
        });
    };

    // 特定の水路の強調表示（ハイライト）
    const highlightWaterway = (id, polyline) => {
        clearHighlights();
        
        selectedType = 'waterway';
        selectedId = id;
        selectedWaterwayPolyline = polyline;
        
        // 再描画して選択されたスタイルを適用
        drawWaterways();
        
        // リストのアクティブクラスの同期
        const items = document.querySelectorAll('.system-item');
        items.forEach(item => {
            if (item.dataset.id === id) {
                item.classList.add('active');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    };

    const clearHighlights = () => {
        selectedWaterwayPolyline = null;
        
        const activeItems = document.querySelectorAll('.system-item.active');
        activeItems.forEach(item => item.classList.remove('active'));

        // 施設ピンの選択解除も行う
        const selectedFacilities = document.querySelectorAll('.facility-marker-icon.selected');
        selectedFacilities.forEach(icon => icon.classList.remove('selected'));
    };

    const showWaterwayInfo = (feature, isNew = false) => {
        selectedType = 'waterway';
        selectedId = feature.properties.id;

        const sysNoInput = document.getElementById('waterway-sys-no');
        const nameInput = document.getElementById('waterway-name');
        const weightSelect = document.getElementById('waterway-weight');
        const colorSelect = document.getElementById('waterway-color');
        const descTextarea = document.getElementById('waterway-desc');
        const addActions = document.getElementById('waterway-add-actions');
        const decBtn = document.getElementById('btn-sys-no-dec');
        const incBtn = document.getElementById('btn-sys-no-inc');

        sysNoInput.value = feature.properties.sysNo || '';
        nameInput.value = feature.properties.name || '';
        
        // 太さの初期化と、それに連動した色の選択肢の初期レンダリング
        const currentWeight = feature.properties.lineWeight || 'main';
        weightSelect.value = currentWeight;
        updateColorOptions(currentWeight, feature.properties.lineColor || 'blue-dark');
        
        descTextarea.value = feature.properties.description || '';

        const editActions = document.getElementById('waterway-edit-actions');
        if (isNew) {
            // 新規追加時は「追加する」「キャンセル」ボタンを表示、既存用は隠す
            addActions.style.display = 'flex';
            editActions.style.display = 'none';
        } else {
            // 既存編集時は「更新する」「削除」ボタンを表示、新規用は隠す
            addActions.style.display = 'none';
            editActions.style.display = 'flex';
        }

        // +/- ボタンクリック時の増減制御（インプット表示数値のみ変更）
        decBtn.onclick = () => {
            const cur = parseInt(sysNoInput.value) || 1;
            sysNoInput.value = Math.max(1, cur - 1);
        };
        incBtn.onclick = () => {
            const cur = parseInt(sysNoInput.value) || 1;
            sysNoInput.value = Math.max(1, cur + 1);
        };

        // 太さ選択変更時の色選択肢の動的入れ替え
        weightSelect.onchange = (e) => {
            const weightVal = e.target.value;
            let curColor = colorSelect.value || 'blue-dark';
            if (weightVal === 'main' && curColor.endsWith('-light')) {
                curColor = curColor.replace('-light', '-dark');
            } else if (weightVal === 'branch' && curColor.endsWith('-dark')) {
                curColor = curColor.replace('-dark', '-light');
            }
            updateColorOptions(weightVal, curColor);
        };

        // 「更新する」ボタン押下時に初めてデータを一括確定反映
        document.getElementById('btn-waterway-update').onclick = () => {
            feature.properties.sysNo = sysNoInput.value;
            feature.properties.name = nameInput.value;
            feature.properties.lineWeight = weightSelect.value;
            feature.properties.lineColor = colorSelect.value;
            feature.properties.description = descTextarea.value;

            // 地図と系統一覧の再描画・更新
            drawWaterways();
            updateSystemList();
            showToast("系統情報を更新しました。");
        };

        waterwayInfoCard.style.display = 'block';
        facilityInfoCard.style.display = 'none';
        infoEmpty.style.display = 'none';
    };

    // 系統一覧リストのレンダリング
    const updateSystemList = () => {
        systemList.innerHTML = '';
        const systems = waterwaysData.features.filter(f => f.geometry && f.geometry.type === 'LineString');

        if (systems.length === 0) {
            systemList.innerHTML = '<div class="empty-list-text">登録された系統がありません</div>';
            return;
        }

        systems.sort((a, b) => {
            const noA = parseInt(a.properties.sysNo) || 999;
            const noB = parseInt(b.properties.sysNo) || 999;
            return noA - noB;
        });

        systems.forEach(sys => {
            const id = sys.properties.id;
            const sysNo = sys.properties.sysNo || '-';
            const name = sys.properties.name || '名称未設定';

            const item = document.createElement('div');
            item.className = `system-item ${selectedId === id ? 'active' : ''}`;
            item.dataset.id = id;

            item.innerHTML = `
                <div class="system-info">
                    <span class="system-badge">${sysNo}</span>
                    <span class="system-name">${name}</span>
                </div>
            `;

            // リストクリック時：ハイライトと地図のフィット
            item.addEventListener('click', () => {
                showWaterwayInfo(sys);
                highlightWaterway(id, null);
                
                // 地図の表示領域をこの水路にフィットさせる
                const coords = sys.geometry.coordinates;
                const latlngs = coords.map(c => [c[1], c[0]]);
                map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [100, 100] });
            });



            systemList.appendChild(item);
        });
    };

    // 7. 施設マーカーの描画とコントロール
    const getFacilityIcon = (type) => {
        switch (type) {
            case 'intake': return 'fa-water';          // 取水口
            case 'gate': return 'fa-door-closed';      // 水門・止水板
            case 'junction': return 'fa-code-branch';  // 分岐点
            default: return 'fa-location-pin';          // その他
        }
    };

    const drawFacilities = () => {
        facilitiesLayerGroup.clearLayers();
        if (!waterwaysData || !waterwaysData.features) return;

        waterwaysData.features.forEach(feature => {
            if (feature.properties && feature.properties.isFacility && feature.geometry && feature.geometry.type === 'Point') {
                const coords = feature.geometry.coordinates;
                const latlng = [coords[1], coords[0]];
                const type = feature.properties.facilityType || 'other';
                const id = feature.properties.id;

                const isSelected = (selectedType === 'facility' && selectedId === id);

                // カスタムフォントアイコンDivIconの作成
                const iconHtml = `<i class="fa-solid ${getFacilityIcon(type)}"></i>`;
                const customIcon = L.divIcon({
                    html: iconHtml,
                    className: `facility-marker-icon ${type} ${isSelected ? 'selected' : ''}`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                const marker = L.marker(latlng, { icon: customIcon });

                marker.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    handleFacilitySelect(feature, marker);
                });

                marker.bindTooltip(feature.properties.name || '名称未設定の施設');

                facilitiesLayerGroup.addLayer(marker);
            }
        });
    };

    const handleFacilitySelect = (feature, marker) => {
        if (currentMode === 'view') {
            showFacilityInfo(feature);
            
            // 地図上のピンに selected クラスを付与するため再描画
            selectedType = 'facility';
            selectedId = feature.properties.id;
            drawFacilities();
        }
    };

    // 施設所属系統の選択プルダウンの同期
    const updateFacilityWaterwayOptions = (currentVal) => {
        const select = document.getElementById('facility-waterway-id');
        select.innerHTML = '<option value="">-- 系統を選択 (未所属) --</option>';

        const systems = waterwaysData.features.filter(f => f.geometry && f.geometry.type === 'LineString');
        systems.forEach(sys => {
            const option = document.createElement('option');
            option.value = sys.properties.id;
            option.innerText = `系統: ${sys.properties.sysNo || '-'} ${sys.properties.name || '未指定'}`;
            if (sys.properties.id === currentVal) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    };

    const showFacilityInfo = (feature) => {
        selectedType = 'facility';
        selectedId = feature.properties.id;

        const nameInput = document.getElementById('facility-name');
        const typeSelect = document.getElementById('facility-type');
        const waterwaySelect = document.getElementById('facility-waterway-id');
        const descTextarea = document.getElementById('facility-desc');
        const imgInput = document.getElementById('facility-image-input');
        const imgPreview = document.getElementById('facility-image-preview');
        const noImgText = document.getElementById('no-image-text');
        const uploadTrigger = document.getElementById('btn-upload-trigger');

        nameInput.value = feature.properties.name || '';
        typeSelect.value = feature.properties.facilityType || 'other';
        descTextarea.value = feature.properties.description || '';

        // 所属系統プルダウンの同期
        updateFacilityWaterwayOptions(feature.properties.waterwayId);

        // 画像の同期
        if (feature.properties.imageUrl) {
            imgPreview.src = feature.properties.imageUrl;
            imgPreview.style.display = 'block';
            noImgText.style.display = 'none';
        } else {
            imgPreview.src = '';
            imgPreview.style.display = 'none';
            noImgText.style.display = 'flex';
        }

        // 「更新する」ボタン押下時に初めてデータを一括確定反映
        document.getElementById('btn-facility-update').onclick = () => {
            feature.properties.name = nameInput.value;
            feature.properties.facilityType = typeSelect.value;
            feature.properties.waterwayId = waterwaySelect.value;
            feature.properties.description = descTextarea.value;
            
            // 地図の再描画
            drawFacilities();
            showToast("施設情報を更新しました。");
        };

        // 編集用のアクションボタンコンテナを表示
        document.getElementById('facility-edit-actions').style.display = 'flex';

        // 写真アップロードのバインド
        uploadTrigger.onclick = () => imgInput.click();
        
        imgInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // アップロードフォームの作成
            const formData = new FormData();
            formData.append('file', file);

            try {
                uploadTrigger.disabled = true;
                uploadTrigger.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> アップロード中...';

                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) throw new Error("アップロードに失敗しました。");
                const resData = await response.json();

                // 施設ピンにURLを記録
                feature.properties.imageUrl = resData.url;
                
                // プレビューの更新
                imgPreview.src = resData.url;
                imgPreview.style.display = 'block';
                noImgText.style.display = 'none';

                showToast("写真のアップロードが完了しました！");
            } catch (error) {
                console.error("Upload error:", error);
                showToast("写真のアップロードに失敗しました。", false);
            } finally {
                uploadTrigger.disabled = false;
                uploadTrigger.innerHTML = '<i class="fa-solid fa-camera"></i> 写真をアップロード';
                imgInput.value = ''; // ファイル選択をリセット
            }
        };

        waterwayInfoCard.style.display = 'none';
        facilityInfoCard.style.display = 'block';
        infoEmpty.style.display = 'none';
    };

    const resetInfoPanel = () => {
        selectedType = null;
        selectedId = null;
        clearHighlights();
        waterwayInfoCard.style.display = 'none';
        facilityInfoCard.style.display = 'none';
        infoEmpty.style.display = 'block';
        
        // 追加・編集アクションボタンエリアも隠す
        document.getElementById('waterway-add-actions').style.display = 'none';
        document.getElementById('waterway-edit-actions').style.display = 'none';
        document.getElementById('facility-edit-actions').style.display = 'none';
        
        // 再描画して強調をクリア
        drawWaterways();
        drawFacilities();
        updateSystemList(); // 系統一覧も即座に更新する
    };

    // 8. 地図クリック処理（水路・施設追加用）
    function handleMapClick(e) {
        // --- 施設（ピン）追加モード ---
        if (currentMode === 'add-facility') {
            const latlng = e.latlng;
            const newId = "facility_" + Date.now();

            // 現在選択されている系統があれば、それを自動で紐付け
            const currentWaterwayId = (selectedType === 'waterway') ? selectedId : "";

            const newFacility = {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [latlng.lng, latlng.lat]
                },
                properties: {
                    id: newId,
                    isFacility: true,
                    facilityType: "gate", // デフォルトは水門/止水板
                    name: "新規施設_" + (waterwaysData.features.filter(f => f.properties.isFacility).length + 1),
                    waterwayId: currentWaterwayId,
                    description: "",
                    imageUrl: ""
                }
            };

            waterwaysData.features.push(newFacility);

            // 再描画
            drawFacilities();

            // 閲覧モードに戻し、詳細を表示
            setMode('view');
            showFacilityInfo(newFacility);
            
            // 強調表示状態の同期
            selectedType = 'facility';
            selectedId = newId;
            drawFacilities();
            
            showToast("新しい施設ピンをプロットしました。");
            return;
        }

        // --- 水路追加モード ---
        if (currentMode === 'add') {
            const latlng = e.latlng;
            draftLatLngs.push(latlng);

            // クリック箇所に小さなポイントを表示
            const marker = L.circleMarker(latlng, {
                radius: 4,
                fillColor: '#f59e0b', // オレンジ色
                color: '#ffffff',
                weight: 1,
                fillOpacity: 1
            }).addTo(draftLayerGroup);
            draftMarkers.push(marker);

            // 下書き線の更新
            if (draftPolyline) {
                draftPolyline.setLatLngs(draftLatLngs);
            } else {
                draftPolyline = L.polyline(draftLatLngs, {
                    color: '#f59e0b',
                    weight: 4,
                    dashArray: '5, 5',
                    opacity: 0.8
                }).addTo(draftLayerGroup);
            }
        }
    }

    // ダブルクリックで新規水路を確定
    function handleMapDblClick(e) {
        if (currentMode !== 'add' || draftLatLngs.length < 2) return;

        // ダブルクリックによる最後の重複点を防止
        map.doubleClickZoom.disable(); // ダブルクリックでズームするのを一時防ぐ

        // 新しいフィーチャーを作成
        const newId = "waterway_" + Date.now();
        const coords = draftLatLngs.map(latlng => [latlng.lng, latlng.lat]);

        const nextSysNo = (waterwaysData.features.filter(f => f.geometry && f.geometry.type === 'LineString').length + 1).toString();

        pendingWaterway = {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: coords
            },
            properties: {
                id: newId,
                sysNo: nextSysNo,
                name: "新規水路_" + nextSysNo,
                lineWeight: "main",
                lineColor: "blue-dark",
                description: ""
            }
        };

        // この時点では waterwaysData.features には push せず、下書き状態の見た目を維持
        // 新規追加モードで詳細カードを表示
        showWaterwayInfo(pendingWaterway, true);

        // 自動的に系統番号入力フィールドにフォーカスを当て、そこへスクロール
        const sysNoInput = document.getElementById('waterway-sys-no');
        if (sysNoInput) {
            sysNoInput.focus();
            sysNoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // ダブルクリックズームを戻す
        setTimeout(() => {
            map.doubleClickZoom.enable();
        }, 500);
    }
    // 最後にプロットした点を取り消す（Undo）
    const undoLastDraftPoint = () => {
        if (draftLatLngs.length === 0) return;

        // 1. 座標リストから最後の要素を削除
        draftLatLngs.pop();

        // 2. 地図上から最後のマーカーを取り除く
        const lastMarker = draftMarkers.pop();
        if (lastMarker) {
            draftLayerGroup.removeLayer(lastMarker);
        }

        // 3. 下書き線の再描画
        if (draftPolyline) {
            if (draftLatLngs.length === 0) {
                draftLayerGroup.removeLayer(draftPolyline);
                draftPolyline = null;
            } else {
                draftPolyline.setLatLngs(draftLatLngs);
            }
        }

        showToast("1つ前の頂点を取り消しました。");
    };

    // キーボードショートカット (Ctrl + Z) での Undo 監視
    document.addEventListener('keydown', (e) => {
        if (currentMode === 'add' && draftLatLngs.length > 0) {
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undoLastDraftPoint();
            }
        }
    });


    const clearDraft = () => {
        draftLatLngs = [];
        draftLayerGroup.clearLayers();
        draftPolyline = null;
        draftMarkers = [];
    };

    btnClearDraft.addEventListener('click', () => {
        clearDraft();
        pendingWaterway = null;
        showToast("下書きをクリアしました。");
    });

    // 新規水路「追加する」決定ボタンのイベントリスナー
    document.getElementById('btn-waterway-confirm').addEventListener('click', () => {
        if (!pendingWaterway) return;

        // 正規データ配列に追加
        waterwaysData.features.push(pendingWaterway);

        // 下書きを消去
        clearDraft();

        // 描画更新
        drawWaterways();
        drawFacilities();
        updateSystemList();

        // 一時データをリセットし閲覧モードへ戻る
        pendingWaterway = null;
        setMode('view');
        
        showToast("水路系統を追加しました。");
    });

    // 新規水路「キャンセル」ボタンのイベントリスナー
    document.getElementById('btn-waterway-cancel').addEventListener('click', () => {
        // 下書きを消去
        clearDraft();
        pendingWaterway = null;

        // 選択パネルをリセットし閲覧モードへ戻る
        resetInfoPanel();
        setMode('view');
        
        showToast("追加をキャンセルしました。");
    });

    // 既存水路の「この系統を削除」ボタンのイベントリスナー
    document.getElementById('btn-waterway-delete').addEventListener('click', () => {
        if (!selectedId || selectedType !== 'waterway') return;

        const waterwayId = selectedId;
        const waterwayFeature = waterwaysData.features.find(f => f.properties.id === waterwayId);
        if (!waterwayFeature) return;

        if (confirm(`この系統「${waterwayFeature.properties.name || '名称未設定'}」を削除しますか？`)) {
            // 所属する施設ピンも連動して削除するか確認
            const relatedCount = waterwaysData.features.filter(f => f.properties.isFacility && f.properties.waterwayId === waterwayId).length;
            let deleteRelated = false;
            if (relatedCount > 0) {
                deleteRelated = confirm(`この水路に紐付けられている施設が ${relatedCount} 件あります。施設も一緒に削除しますか？`);
            }

            if (deleteRelated) {
                waterwaysData.features = waterwaysData.features.filter(f => f.properties.waterwayId !== waterwayId);
            } else if (relatedCount > 0) {
                // 施設は残し、所属系統の紐付けのみ解除
                waterwaysData.features.forEach(f => {
                    if (f.properties.isFacility && f.properties.waterwayId === waterwayId) {
                        f.properties.waterwayId = "";
                    }
                });
            }

            // 水路の削除
            waterwaysData.features = waterwaysData.features.filter(f => f.properties.id !== waterwayId);

            // 表示リセット
            resetInfoPanel();
            
            showToast("系統を削除しました。");
        }
    });

    // 既存施設の「この施設を削除」ボタンのイベントリスナー
    document.getElementById('btn-facility-delete').addEventListener('click', () => {
        if (!selectedId || selectedType !== 'facility') return;

        const facilityId = selectedId;
        const facilityFeature = waterwaysData.features.find(f => f.properties.id === facilityId);
        if (!facilityFeature) return;

        if (confirm(`この施設「${facilityFeature.properties.name || '名称未設定'}」を削除しますか？`)) {
            // 施設の削除
            waterwaysData.features = waterwaysData.features.filter(f => f.properties.id !== facilityId);

            // 表示リセット
            resetInfoPanel();
            
            showToast("施設を削除しました。");
        }
    });

    // 8. データの保存
    btnSaveWaterways.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/waterways', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ geojson: waterwaysData })
            });

            if (!response.ok) throw new Error("保存処理に失敗しました。");
            const resData = await response.json();
            
            showToast("水路データをローカルに保存しました！");
        } catch (error) {
            console.error("Save error:", error);
            showToast("データの保存に失敗しました。", false);
        }
    });

    // ローカルファイルへのエクスポート (別名保存)
    document.getElementById('btn-export-file').addEventListener('click', () => {
        if (!waterwaysData) return;

        // 日付スタンプの作成
        const now = new Date();
        const dateStr = now.getFullYear() + 
                        String(now.getMonth() + 1).padStart(2, '0') + 
                        String(now.getDate()).padStart(2, '0');
        const filename = `waterways_${dateStr}.json`;

        try {
            const blob = new Blob([JSON.stringify(waterwaysData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showToast("ファイルに出力しました。");
        } catch (error) {
            console.error("Export error:", error);
            showToast("ファイル出力に失敗しました。", false);
        }
    });

    // ファイルインポートトリガー
    const importTrigger = document.getElementById('btn-import-file-trigger');
    const importInput = document.getElementById('input-import-file');

    importTrigger.addEventListener('click', () => {
        importInput.click();
    });

    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);

                // 簡易的なフォーマット（GeoJSON）検証
                if (!importedData || importedData.type !== 'FeatureCollection' || !Array.isArray(importedData.features)) {
                    throw new Error("正しい水路データフォーマット (GeoJSON FeatureCollection) ではありません。");
                }

                // 読み込んだデータで上書き
                waterwaysData = importedData;

                // 描画とリストの更新
                drawWaterways();
                drawFacilities();
                updateSystemList();
                resetInfoPanel();

                // インポートしたデータの位置へカメラを自動ジャンプ・フィット
                const fitted = fitMapToData();
                if (fitted) {
                    showToast("ファイルを読み込み、データの位置へ移動しました。");
                } else {
                    showToast("ファイルを読み込みました（データが空です）。");
                }
            } catch (error) {
                console.error("Import parse error:", error);
                showToast("ファイルの読み込みに失敗しました。正しいJSONファイルかご確認ください。", false);
            }
            importInput.value = ''; // 連続インポート対応のためにクリア
        };
        reader.readAsText(file);
    });

    // 登録データ（水路・施設）の全座標を囲む範囲にカメラをフィットさせる
    const fitMapToData = (padding = [50, 50]) => {
        if (!waterwaysData || !waterwaysData.features || waterwaysData.features.length === 0) return false;

        const allLatLngs = [];
        waterwaysData.features.forEach(f => {
            if (f.geometry) {
                if (f.geometry.type === 'LineString') {
                    f.geometry.coordinates.forEach(c => allLatLngs.push([c[1], c[0]]));
                } else if (f.geometry.type === 'Point') {
                    const c = f.geometry.coordinates;
                    allLatLngs.push([c[1], c[0]]);
                }
            }
        });

        if (allLatLngs.length > 0) {
            const bounds = L.latLngBounds(allLatLngs);
            map.fitBounds(bounds, { padding: padding });
            return true;
        }
        return false;
    };

    // GPS現在地を取得して地図を表示する
    const showCurrentLocation = () => {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve(false);
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    map.setView([lat, lng], 16); // 現在地にカメラを移動しズーム16に設定
                    resolve(true);
                },
                (error) => {
                    console.warn("Geolocation error:", error);
                    resolve(false);
                },
                { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
            );
        });
    };

    // アプリ起動（順次実行してデータ取得競合とブロッキングを防ぐ）
    const startApp = async () => {
        initMap();
        await loadWaterways(); // サーバーから初期データをロード

        // 起動時カメラ位置決定フロー
        
        // 1. 優先度①: localStorage に前回の表示位置があるか？
        const lastLocStr = localStorage.getItem('suiri_map_last_location');
        if (lastLocStr) {
            try {
                const lastLoc = JSON.parse(lastLocStr);
                map.setView([lastLoc.lat, lastLoc.lng], lastLoc.zoom);
                return; // カメラ設定完了
            } catch (e) {
                console.error("Failed to parse last location:", e);
            }
        }

        // 2. 優先度②: 読み込まれた既存データがあるか？
        const hasData = fitMapToData();
        if (hasData) {
            return; // カメラ設定完了
        }

        // 3. 優先度③: GPS現在地の取得を試みる
        const hasGPS = await showCurrentLocation();
        if (hasGPS) {
            return; // カメラ設定完了
        }

        // 4. 優先度④: 最終デフォルト：日本全体を表示（initMapで仮置きした [36.0, 137.5], zoom 5 のまま開始）
    };
    startApp();
});
