// =========================================================
// 🛑 PASTE YOUR FIREBASE CONFIGURATION HERE 🛑
// Get this from the Firebase Console (Project Settings > Web App)
// =========================================================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};
// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();


// --- STATE & CONFIGURATION ---
const THRESHOLDS = { warning: 60, critical: 85 }; 
const COLORS = { safe: '#00E5FF', warn: '#FFaa00', danger: '#FF003C', escalate: '#B026FF' };
let totalInterventions = 0; let protocolBreaches = 0; let riskChart; let clockSeconds = 6120;

const patientZones = {
    head: { meshes: [], pressure: 20, timeHours: 0.5, isAlerted: false, alertStartTime: 0, hasBreached: false },
    elbow: { meshes: [], pressure: 20, timeHours: 1.2, isAlerted: false, alertStartTime: 0, hasBreached: false },
    buttocks: { meshes: [], pressure: 20, timeHours: 2.5, isAlerted: false, alertStartTime: 0, hasBreached: false },
    heel: { meshes: [], pressure: 20, timeHours: 0.1, isAlerted: false, alertStartTime: 0, hasBreached: false }
};

let audioCtx; let isAudioEnabled = false; let alarmInterval = null; let activeAlarmsCount = 0; let typeTimeout;

// --- FIREBASE REAL-TIME LISTENER ---
// This listens to the phone and updates the pressures instantly
db.ref('bed').on('value', (snapshot) => {
    const bedData = snapshot.val();
    if (bedData) {
        if (bedData.head) patientZones.head.pressure = bedData.head.pressure;
        if (bedData.elbow) patientZones.elbow.pressure = bedData.elbow.pressure;
        if (bedData.buttocks) patientZones.buttocks.pressure = bedData.buttocks.pressure;
        if (bedData.heel) patientZones.heel.pressure = bedData.heel.pressure;
    }
});


// --- UI & AUDIO FUNCTIONS ---
window.toggleFullScreen = function() {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen(); } 
    else { if (document.exitFullscreen) document.exitFullscreen(); }
};

function initAudio() { 
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
    if (audioCtx.state === 'suspended') audioCtx.resume(); 
}

window.toggleAudio = function() {
    isAudioEnabled = !isAudioEnabled; const btn = document.getElementById('sound-toggle');
    if (isAudioEnabled) {
        initAudio(); btn.innerHTML = '[ AUDIO : ARMED ]'; btn.className = "bg-safe/20 border border-safe text-safe font-mono text-[9px] tracking-widest px-3 py-1.5 rounded-sm transition-all uppercase backdrop-blur-md shadow-[0_0_10px_rgba(0,229,255,0.3)]";
        playConfirmSound(); if (activeAlarmsCount > 0 && !alarmInterval) startPersistentAlarm();
    } else {
        btn.innerHTML = '[ AUDIO : OFF ]'; btn.className = "bg-black/50 border border-safe/30 text-safe hover:bg-safe/20 font-mono text-[9px] tracking-widest px-3 py-1.5 rounded-sm transition-all uppercase backdrop-blur-md"; stopPersistentAlarm();
    }
}

function playTone(freq, type, dur, vol) {
    if (!isAudioEnabled || !audioCtx) return;
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + dur);
}

function playUrgentSequence() {
    if (!isAudioEnabled) return; const p = 950; const v = 0.3;
    playTone(p, 'triangle', 0.15, v); setTimeout(() => playTone(p, 'triangle', 0.15, v), 200); setTimeout(() => playTone(p, 'triangle', 0.15, v), 400);
    setTimeout(() => playTone(p, 'triangle', 0.15, v), 800); setTimeout(() => playTone(p, 'triangle', 0.15, v), 1000);
}
function startPersistentAlarm() { if (alarmInterval || !isAudioEnabled) return; playUrgentSequence(); alarmInterval = setInterval(playUrgentSequence, 3000); }
function stopPersistentAlarm() { if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null; } }
function playConfirmSound() { playTone(523.25, 'sine', 0.2, 0.1); setTimeout(() => playTone(659.25, 'sine', 0.4, 0.1), 150); }

function typeAIInsights(message, colorClass = "text-safe") {
    const terminal = document.getElementById('ai-terminal');
    clearTimeout(typeTimeout); terminal.innerHTML = `<span class="${colorClass}"></span>`;
    const span = terminal.querySelector('span'); let i = 0;
    function typeChar() { if (i < message.length) { span.innerHTML += message.charAt(i); i++; typeTimeout = setTimeout(typeChar, 20); } }
    typeChar();
}

window.toggleModal = function(id) { 
    const m = document.getElementById(id); 
    if (m.classList.contains('opacity-0')) {
        m.classList.remove('opacity-0', 'pointer-events-none'); m.classList.add('opacity-100', 'pointer-events-auto');
        document.getElementById('report-time').innerText = new Date().toLocaleString(); 
        document.getElementById('stat-prevented').innerText = totalInterventions; document.getElementById('stat-breaches').innerText = protocolBreaches;
    } else {
        m.classList.remove('opacity-100', 'pointer-events-auto'); m.classList.add('opacity-0', 'pointer-events-none');
    }
}

function updateAlertBadge() {
    const badge = document.getElementById('alert-badge');
    if(activeAlarmsCount > 0) {
        badge.className = 'text-[9px] font-mono text-danger tracking-widest animate-pulse'; badge.innerText = `${activeAlarmsCount} CRITICAL`; document.getElementById('empty-alert-msg').style.display = 'none';
    } else {
        badge.className = 'text-[9px] font-mono text-slate-400 tracking-widest'; badge.innerText = `0 PENDING`; document.getElementById('empty-alert-msg').style.display = 'flex';
        typeAIInsights("System nominal. Encrypted telemetry streaming from spatial bed matrix.");
    }
}

window.repositionPatient = function(zoneKey, btnEl) {
    patientZones[zoneKey].timeHours = 0; 
    patientZones[zoneKey].pressure = 20; // Reset to safe
    db.ref('bed/' + zoneKey).set({ pressure: 20 }); // Tell Firebase it's safe now too
    
    patientZones[zoneKey].isAlerted = false; patientZones[zoneKey].hasBreached = false;
    btnEl.closest('.alert-card').remove();
    activeAlarmsCount--; if (activeAlarmsCount <= 0) { activeAlarmsCount = 0; stopPersistentAlarm(); }
    clockSeconds = 7200; updateAlertBadge(); totalInterventions++; playConfirmSound(); 
};

function triggerAlert(zoneKey, riskScore) {
    if (patientZones[zoneKey].isAlerted) return;
    patientZones[zoneKey].isAlerted = true; patientZones[zoneKey].alertStartTime = Date.now(); activeAlarmsCount++; startPersistentAlarm(); 
    
    const container = document.getElementById('alert-container');
    let actionText = "Lateral Shift"; if(zoneKey === 'heel') actionText = "Heel Offload";
    typeAIInsights(`ALERT: Encryption tunnel secure. Identifying compound risk at ${zoneKey.toUpperCase()}.`, "text-danger");

    const alertHTML = `
        <div id="alert-${zoneKey}" class="alert-card relative bg-danger/10 border border-danger/50 p-3 overflow-hidden backdrop-blur-md transition-all duration-500 mb-2">
            <div class="flex justify-between items-start mb-2 relative z-10">
                <div>
                    <p id="alert-status-${zoneKey}" class="text-[9px] font-mono text-danger tracking-widest uppercase flex items-center gap-1">
                        <span class="w-1.5 h-1.5 bg-danger animate-pulse"></span> TIER 1 ALARM
                    </p>
                    <p class="hud-title text-white mt-1">${zoneKey} ULCER RISK</p>
                </div>
                <div class="hud-data text-xl text-danger drop-shadow-[0_0_10px_rgba(255,0,60,0.5)]">${Math.round(riskScore)}</div>
            </div>
            <div class="flex justify-between items-center mt-2 pt-2 border-t border-danger/30 relative z-10">
                <p class="text-[9px] text-safe font-mono uppercase tracking-widest">> ${actionText}</p>
                <button id="btn-${zoneKey}" onclick="repositionPatient('${zoneKey}', this)" class="bg-danger/20 hover:bg-danger text-white text-[8px] font-mono tracking-widest px-2 py-1 uppercase border border-danger transition-colors">RESOLVE</button>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('afterbegin', alertHTML); updateAlertBadge();
}

// --- 3D ENGINE & INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    
    const ctx = document.getElementById('riskChart').getContext('2d');
    let gradient = ctx.createLinearGradient(0, 0, 0, 100); gradient.addColorStop(0, 'rgba(0, 229, 255, 0.4)'); gradient.addColorStop(1, 'rgba(0, 229, 255, 0.0)');
    
    riskChart = new Chart(ctx, {
        type: 'line',
        data: { labels: Array(20).fill(''), datasets: [{ data: Array(20).fill(30), borderColor: COLORS.safe, backgroundColor: gradient, borderWidth: 1, fill: true, tension: 0.3, pointRadius: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { y: { display: false, min: 0, max: 150 }, x: { display: false } }, animation: { duration: 500 } }
    });

    const container3d = document.getElementById('canvas-container');
    const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x02040a, 0.03);
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000); 
    camera.position.set(0, 0, 14); 
    
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(window.innerWidth, window.innerHeight); 
    container3d.appendChild(renderer.domElement);
    
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.target.set(0, 0, 0); controls.enablePan = false; controls.minDistance = 2; controls.maxDistance = 30;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dirLight = new THREE.DirectionalLight(0x00E5FF, 2.0); dirLight.position.set(5, 10, 7); scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0xB026FF, 2.0); backLight.position.set(-5, -5, -7); scene.add(backLight);

    const manGroup = new THREE.Group();
    const manMat = new THREE.MeshStandardMaterial({ color: 0x006699, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.7 });

    const loader = new THREE.GLTFLoader();
    loader.load('patient.glb', function (gltf) {
        const humanModel = gltf.scene;
        humanModel.traverse((child) => { if (child.isMesh) { child.material = manMat; } });

        const box = new THREE.Box3().setFromObject(humanModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const scale = 10 / maxDim;
            humanModel.scale.set(scale, scale, scale);
        }

        const scaledBox = new THREE.Box3().setFromObject(humanModel);
        const center = scaledBox.getCenter(new THREE.Vector3());
        humanModel.position.sub(center); 
        
        manGroup.add(humanModel);
    }, undefined, function (error) {
        console.error('Error loading the model:', error);
    });
    
    const gridHelper = new THREE.GridHelper(20, 20, 0x00E5FF, 0x00E5FF); gridHelper.position.y = -5; gridHelper.material.opacity = 0.1; gridHelper.material.transparent = true; scene.add(gridHelper);
    scene.add(manGroup);

    function createSensor(x, y, z) {
        const group = new THREE.Group(); group.position.set(x, y, z);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00E5FF, transparent: true, opacity: 0.8, depthTest: false });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), mat);
        mesh.renderOrder = 999;
        const light = new THREE.PointLight(0x00E5FF, 5, 10);
        group.add(mesh); group.add(light); manGroup.add(group);
        return { group, mesh, light };
    }
    
    patientZones.head.meshes.push(createSensor(0, 4.0, 0.5)); 
    patientZones.elbow.meshes.push(createSensor(2.5, 0.5, 0));  
    patientZones.elbow.meshes.push(createSensor(-2.5, 0.5, 0)); 
    patientZones.buttocks.meshes.push(createSensor(0, -1.0, -1.0)); 
    patientZones.heel.meshes.push(createSensor(-1.0, -4.8, -0.5));
    patientZones.heel.meshes.push(createSensor(1.0, -4.8, -0.5));

    window.addEventListener('resize', () => { 
        camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); 
    });

    function animate3d() {
        requestAnimationFrame(animate3d); if(controls) controls.update(); manGroup.rotation.y = Math.sin(Date.now() * 0.0002) * 0.3; 
        
        Object.values(patientZones).forEach(zone => {
            zone.meshes.forEach(sensor => {
                const currentHex = sensor.mesh.material.color.getHex();
                if (currentHex === 0xFF003C || currentHex === 0xB026FF) {
                    const pulse = 1.2 + 0.4 * Math.sin(Date.now() * 0.008); 
                    sensor.mesh.scale.set(pulse, pulse, pulse); 
                    sensor.light.intensity = 15 + 5 * Math.sin(Date.now() * 0.008); 
                } else { 
                    sensor.mesh.scale.set(1, 1, 1); 
                    sensor.light.intensity = 5; 
                }
            });
        });
        renderer.render(scene, camera);
    }
    animate3d();

    // Core Dashboard Tick (UI Updates ONLY - Pressure comes from Firebase now)
    function runSimulationTick() {
        let maxRisk = 0; const now = Date.now();
        document.getElementById('hud-bpm').innerText = 70 + Math.floor(Math.random() * 4);
        
        Object.keys(patientZones).forEach(zoneKey => {
            const data = patientZones[zoneKey]; 
            
            // Risk math: High pressure over time = Bad
            const riskScore = data.pressure * (1 + (data.timeHours * 0.15));
            if (riskScore > maxRisk) maxRisk = riskScore;
            
            let colorHex = COLORS.safe;
            if (riskScore >= THRESHOLDS.critical) { colorHex = COLORS.danger; triggerAlert(zoneKey, riskScore); } 
            else if (riskScore >= THRESHOLDS.warning) { colorHex = COLORS.warn; }

            if (data.isAlerted) {
                const elapsed = (now - data.alertStartTime) / 1000;
                const statusTxt = document.getElementById(`alert-status-${zoneKey}`);
                const btn = document.getElementById(`btn-${zoneKey}`);
                
                if (elapsed > 10 && elapsed <= 20) {
                    if(statusTxt && statusTxt.innerText.indexOf("TIER 2") === -1) { 
                        statusTxt.innerHTML = `<span class="w-1.5 h-1.5 bg-[#FFaa00] animate-pulse"></span> TIER 2: PAGING RN`; 
                        statusTxt.className = "text-[9px] font-mono text-[#FFaa00] tracking-widest uppercase flex items-center gap-1 drop-shadow-[0_0_5px_rgba(255,170,0,0.8)]"; 
                    }
                    colorHex = COLORS.warn; 
                } else if (elapsed > 20 && elapsed <= 30) {
                    if(statusTxt && statusTxt.innerText.indexOf("TIER 3") === -1) { 
                        statusTxt.innerHTML = `<span class="w-1.5 h-1.5 bg-[#B026FF] animate-pulse"></span> TIER 3: CHARGE NURSE`; 
                        statusTxt.className = "text-[9px] font-mono text-[#B026FF] tracking-widest uppercase flex items-center gap-1 drop-shadow-[0_0_5px_rgba(176,38,255,0.8)]"; 
                    }
                    colorHex = COLORS.escalate; 
                } else if (elapsed > 30) {
                    if(statusTxt && statusTxt.innerText.indexOf("BREACH") === -1) { 
                        statusTxt.innerHTML = `<span class="w-1.5 h-1.5 bg-[#FF003C] animate-pulse"></span> PROTOCOL BREACH`; 
                        statusTxt.className = "text-[9px] font-mono text-[#FF003C] tracking-widest uppercase flex items-center gap-1 drop-shadow-[0_0_5px_rgba(255,0,60,0.8)]"; 
                        if (btn) { btn.innerText = "OVERRIDE & LOG"; btn.className = "bg-[#FF003C] text-white text-[8px] font-mono tracking-widest px-2 py-1 border border-[#FF003C] animate-pulse"; }
                        if (!data.hasBreached) { data.hasBreached = true; protocolBreaches++; }
                    }
                    colorHex = COLORS.danger; 
                }
            }
            data.meshes.forEach(sensor => { 
                if (sensor && sensor.mesh && sensor.light) { 
                    sensor.mesh.material.color.set(colorHex); 
                    sensor.light.color.set(colorHex); 
                } 
            });
        });

        const globalEl = document.getElementById('global-risk-display'); const wardDot = document.getElementById('ward-active-dot');
        globalEl.innerHTML = Math.round(maxRisk);
        
        if(clockSeconds > 0) clockSeconds -= 30; 
        const hrs = Math.floor(clockSeconds / 3600); const mins = Math.floor((clockSeconds % 3600) / 60);
        document.getElementById('turn-timer').innerText = `0${hrs}:${mins < 10 ? '0' : ''}${mins}:00`;
        const dashOffset = 283 - ((clockSeconds / 7200) * 283); document.getElementById('turn-progress').style.strokeDashoffset = Math.max(0, dashOffset);

        const riskBorder = globalEl.parentElement;
        if (maxRisk >= THRESHOLDS.critical) { 
            globalEl.className = 'hud-data text-7xl text-danger drop-shadow-[0_0_20px_rgba(255,0,30,0.8)]'; riskBorder.className = 'flex items-baseline gap-1 bg-black/40 backdrop-blur-lg px-6 py-2 border-r-4 border-b-4 border-danger/80 shadow-[10px_10px_30px_rgba(255,0,60,0.2)]';
            wardDot.className = 'w-2 h-2 bg-danger animate-pulse'; riskChart.data.datasets[0].borderColor = COLORS.danger; 
            const g = ctx.createLinearGradient(0,0,0,100); g.addColorStop(0, 'rgba(255, 0, 60, 0.4)'); g.addColorStop(1, 'rgba(255, 0, 60, 0.0)'); riskChart.data.datasets[0].backgroundColor = g;
            document.getElementById('hud-spo2').innerText = `91%`; document.getElementById('hud-spo2').className = 'hud-data text-xl text-danger';
        } else if (maxRisk >= THRESHOLDS.warning) { 
            globalEl.className = 'hud-data text-7xl text-warn transition-colors'; riskBorder.className = 'flex items-baseline gap-1 bg-black/40 backdrop-blur-lg px-6 py-2 border-r-4 border-b-4 border-warn/80';
            wardDot.className = 'w-2 h-2 bg-warn animate-pulse'; riskChart.data.datasets[0].borderColor = COLORS.warn; 
            const g = ctx.createLinearGradient(0,0,0,100); g.addColorStop(0, 'rgba(255, 170, 0, 0.4)'); g.addColorStop(1, 'rgba(255, 170, 0, 0.0)'); riskChart.data.datasets[0].backgroundColor = g;
        } else { 
            globalEl.className = 'hud-data text-7xl text-safe transition-colors'; riskBorder.className = 'flex items-baseline gap-1 bg-black/40 backdrop-blur-lg px-6 py-2 border-r-4 border-b-4 border-safe/50';
            wardDot.className = 'w-2 h-2 bg-safe shadow-[0_0_8px_#00E5FF]'; riskChart.data.datasets[0].borderColor = COLORS.safe; 
            const g = ctx.createLinearGradient(0,0,0,100); g.addColorStop(0, 'rgba(0, 229, 255, 0.4)'); g.addColorStop(1, 'rgba(0, 229, 255, 0.0)'); riskChart.data.datasets[0].backgroundColor = g;
            document.getElementById('hud-spo2').innerText = `96%`; document.getElementById('hud-spo2').className = 'hud-data text-xl text-safe';
        }
        riskChart.data.datasets[0].data.push(maxRisk); riskChart.data.datasets[0].data.shift(); riskChart.update();
    }
    
    // Updates UI every second
    setInterval(runSimulationTick, 1000); 
    
    // Backup button just in case
    window.forceDemoSpike = function() { 
        patientZones.buttocks.timeHours = 4; 
        db.ref('bed/buttocks').set({ pressure: 95 }); // Send fake signal to firebase
    }
});