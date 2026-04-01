// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBaOZyUjMHAd3cgml0z8Ah3sFSeC3odeYc",
    authDomain: "codeblue-11dfa.firebaseapp.com",
    databaseURL: "https://codeblue-11dfa-default-rtdb.firebaseio.com",
    projectId: "codeblue-11dfa",
    storageBucket: "codeblue-11dfa.firebasestorage.app",
    messagingSenderId: "516581634351",
    appId: "1:516581634351:web:c60a3fa8206a0aba1031da"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- STATE & CONFIGURATION ---
const THRESHOLDS = { warning: 60, critical: 85 }; 
const COLORS = { safe: '#00E5FF', warn: '#FFaa00', danger: '#FF003C', escalate: '#B026FF' };
let totalInterventions = 0; let protocolBreaches = 0; let riskChart; let clockSeconds = 6120;
let manGroup = new THREE.Group(); 

const patientZones = {
    head: { meshes: [], pressure: 20, timeHours: 0.5, isAlerted: false, alertStartTime: 0, hasBreached: false },
    elbow: { meshes: [], pressure: 20, timeHours: 1.2, isAlerted: false, alertStartTime: 0, hasBreached: false },
    buttocks: { meshes: [], pressure: 20, timeHours: 2.5, isAlerted: false, alertStartTime: 0, hasBreached: false },
    heel: { meshes: [], pressure: 20, timeHours: 0.1, isAlerted: false, alertStartTime: 0, hasBreached: false }
};

let audioCtx; let isAudioEnabled = false; let alarmInterval = null; let activeAlarmsCount = 0; let typeTimeout;

// --- FIREBASE REAL-TIME LISTENER ---
db.ref('bed').on('value', (snapshot) => {
    const bedData = snapshot.val();
    if (bedData) {
        // 1. Update Pressures
        if (bedData.head) patientZones.head.pressure = bedData.head.pressure;
        if (bedData.elbow) patientZones.elbow.pressure = bedData.elbow.pressure;
        if (bedData.buttocks) patientZones.buttocks.pressure = bedData.buttocks.pressure;
        if (bedData.heel) patientZones.heel.pressure = bedData.heel.pressure;

        // 2. Update Rotation from Phone Gyroscope
        if (bedData.rotation && manGroup) {
            // Beta = X-axis (forward/back), Gamma = Y-axis (left/right)
            const rotX = bedData.rotation.beta * (Math.PI / 180);
            const rotY = bedData.rotation.gamma * (Math.PI / 180);
            
            // We smooth the rotation and apply sensitivity
            manGroup.rotation.x = rotX * 0.6; 
            manGroup.rotation.y = rotY * 0.6;
        }
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
        typeAIInsights("System nominal. Monitoring spatial bed matrix.");
    }
}

window.repositionPatient = function(zoneKey, btnEl) {
    patientZones[zoneKey].timeHours = 0; 
    patientZones[zoneKey].pressure = 20; 
    db.ref('bed/' + zoneKey).set({ pressure: 20 }); 
    
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
    typeAIInsights(`ALERT: Identifying compound risk at ${zoneKey.toUpperCase()}.`, "text-danger");

    const alertHTML = `
        <div id="alert-${zoneKey}" class="alert-card relative bg-danger/10 border border-danger/50 p-3 overflow-hidden backdrop-blur-md transition-all duration-500 mb-2">
            <div class="flex justify-between items-start mb-2 relative z-10">
                <div><p id="alert-status-${zoneKey}" class="text-[9px] font-mono text-danger tracking-widest uppercase flex items-center gap-1"><span class="w-1.5 h-1.5 bg-danger animate-pulse"></span> TIER 1 ALARM</p><p class="hud-title text-white mt-1">${zoneKey} ULCER RISK</p></div>
                <div class="hud-data text-xl text-danger">${Math.round(riskScore)}</div>
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
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { display: false, min: 0, max: 150 }, x: { display: false } } }
    });

    const container3d = document.getElementById('canvas-container');
    const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x02040a, 0.03);
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000); 
    camera.position.set(0, 0, 14); 
    
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(window.innerWidth, window.innerHeight); 
    container3d.appendChild(renderer.domElement);
    
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    scene.add(manGroup);

    const loader = new THREE.GLTFLoader();
    loader.load('patient.glb', (gltf) => {
        const model = gltf.scene;
        model.traverse(c => { if(c.isMesh) c.material = new THREE.MeshStandardMaterial({ color: 0x006699, transparent: true, opacity: 0.7 }); });
        
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const scale = 10 / maxDim;
            model.scale.set(scale, scale, scale);
        }
        const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
        model.position.sub(center); 
        manGroup.add(model);
    });

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

    function animate3d() {
        requestAnimationFrame(animate3d); controls.update(); 
        
        Object.values(patientZones).forEach(zone => {
            zone.meshes.forEach(sensor => {
                const currentHex = sensor.mesh.material.color.getHex();
                if (currentHex === 0xFF003C) {
                    const pulse = 1.2 + 0.4 * Math.sin(Date.now() * 0.008); 
                    sensor.mesh.scale.set(pulse, pulse, pulse); sensor.light.intensity = 15; 
                } else { sensor.mesh.scale.set(1, 1, 1); sensor.light.intensity = 5; }
            });
        });
        renderer.render(scene, camera);
    }
    animate3d();

    function runSimulationTick() {
        let maxRisk = 0; const now = Date.now();
        Object.keys(patientZones).forEach(zoneKey => {
            const data = patientZones[zoneKey]; 
            const riskScore = data.pressure * (1 + (data.timeHours * 0.15));
            if (riskScore > maxRisk) maxRisk = riskScore;
            let colorHex = (riskScore >= THRESHOLDS.critical) ? COLORS.danger : (riskScore >= THRESHOLDS.warning ? COLORS.warn : COLORS.safe);
            if (riskScore >= THRESHOLDS.critical) triggerAlert(zoneKey, riskScore);
            data.meshes.forEach(sensor => { sensor.mesh.material.color.set(colorHex); sensor.light.color.set(colorHex); });
        });
        document.getElementById('global-risk-display').innerHTML = Math.round(maxRisk);
        riskChart.data.datasets[0].data.push(maxRisk); riskChart.data.datasets[0].data.shift(); riskChart.update();
    }
    setInterval(runSimulationTick, 1000); 
});