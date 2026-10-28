// ============================================================
// TIRR SCORING PLATFORM - Logic Controllers (Alpine.js Components)
// ============================================================

import { auth, db, rtdb, storage, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile,
         collection, onSnapshot, query, orderBy, where, addDoc, doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc,
         ref, set, onValue, update, storageRef, uploadBytes, getDownloadURL, serverTimestamp } from './firebase-config.js';

// ── Control de Expiración de Sesión (2 Horas de Inactividad) ─
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 horas

function isSessionExpired() {
    const lastActive = localStorage.getItem('tirr_last_active');
    if (!lastActive) return true;
    return (Date.now() - Number(lastActive)) > SESSION_TIMEOUT_MS;
}

function touchSession() {
    localStorage.setItem('tirr_last_active', String(Date.now()));
}

function clearSessionData() {
    localStorage.removeItem('misionSeleccionada');
    localStorage.removeItem('activeTab');
    localStorage.removeItem('tirr_last_active');
    localStorage.removeItem('tirr_test_mode');
}

// Escuchar interacciones para renovar la marca de tiempo activa
if (typeof window !== 'undefined') {
    ['click', 'keydown', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (window.Alpine && Alpine.store('app')?.isAuthenticated) {
                touchSession();
            }
        }, { passive: true });
    });
}

function initTIRR() {
    if (window.TIRR_INITIALIZED) return;
    window.TIRR_INITIALIZED = true;

    // ── Global App Store ──────────────────────────────────────
    Alpine.store('app', {
        user: null,
        isAuthenticated: false,
        userRole: null,
        teams: [],
        allCalificaciones: [], // Cache global de calificaciones
        selectedTeamDetails: null, // Para el modal de detalles
        isLoading: false,
        isLoadingInitial: true,
        filtroCategoriaEquipos: 'TODAS',
        isGuest: false, // Modo invitado (sin Firebase Auth)
        isTestMode: false, // Perfil 'Vista de Prueba' para personas externas y revisión IA
        misionSeleccionada: null, // Se asigna en init tras validar expiración
        showMenu: false,
        showLoginModal: false,
        showEditModal: false,
        showEditTeamModal: false, // Modal de edición de equipos
        editingTeam: null, // Equipo en edición
        editingTeamId: null,
        selectedLoginUser: null,
        loginPin: '',
        loginError: null,
        loginLoading: false,
        systemUsers: [
            { id: 1, name: 'Admin TIRR', role: 'ADMINISTRADOR', color: 'red', hex: '#D30000', initial: 'AT', email: 'admin@tirr.com' },
            { id: 2, name: 'Jurado 1', role: 'JURADO', color: 'yellow', hex: '#FFD700', initial: 'J1', email: 'jurado1@tirr.com' },
            { id: 3, name: 'Jurado 2', role: 'JURADO', color: 'yellow', hex: '#FFD700', initial: 'J2', email: 'jurado2@tirr.com' },
            { id: 4, name: 'Jurado 3', role: 'JURADO', color: 'yellow', hex: '#FFD700', initial: 'J3', email: 'jurado3@tirr.com' },
            { id: 5, name: 'Jurado 4', role: 'JURADO', color: 'yellow', hex: '#FFD700', initial: 'J4', email: 'jurado4@tirr.com' },
            { id: 6, name: 'Auxiliar 1', role: 'AUXILIAR JURADO', color: 'emerald', hex: '#10B981', initial: 'A1', email: 'auxiliar1@tirr.com' },
            { id: 7, name: 'Auxiliar 2', role: 'AUXILIAR JURADO', color: 'emerald', hex: '#10B981', initial: 'A2', email: 'auxiliar2@tirr.com' },
            { id: 8, name: 'Cronometrista', role: 'CRONOMETRISTA', color: 'cyan', hex: '#00E5FF', initial: 'C1', email: 'cronometrista1@tirr.com' },
            { id: 9, name: 'Vista de Prueba', role: 'VISTA DE PRUEBA', color: 'purple', hex: '#A855F7', initial: 'VP', email: 'prueba@tirr.com' }
        ],

        get currentJudgeId() {
            if (this.isTestMode) {
                return 'juez_prueba_ia';
            }
            if (this.user) {
                return this.user.uid || this.user.email;
            }
            return 'anonimo';
        },

        get currentJudgeName() {
            if (this.isTestMode) {
                return 'Evaluador de Prueba (IA / Externo)';
            }
            if (this.user) {
                const found = this.systemUsers.find(u => u.email.toLowerCase() === this.user.email?.toLowerCase());
                return found ? found.name : (this.user.displayName || this.user.email || 'Jurado');
            }
            return 'Jurado';
        },

        // Helper para comparar categorías de forma normalizada
        matchesCategoria(teamCat, filterCat) {
            if (!filterCat || filterCat === 'TODAS' || filterCat === 'Todos') return true;
            return String(teamCat || '').trim().toUpperCase() === String(filterCat || '').trim().toUpperCase();
        },

        // Helper para dar formato con número de registro (01 - Nombre)
        formatTeamName(team) {
            if (!team) return '';
            const num = team.numero_registro ? String(team.numero_registro).padStart(2, '0') : '';
            const name = team.nombre_equipo || team.name || 'Sin nombre';
            return num ? `${num} - ${name}` : name;
        },

        // Helper para saber si un equipo ya participó en la misión actual o en general
        hasParticipated(teamId, mision = null) {
            const targetMision = mision || this.misionSeleccionada;
            if (!targetMision || targetMision === '__RESULTADOS_FINALES__' || targetMision === '__GUEST_BYPASS__') {
                return this.allCalificaciones.some(c => c.id_equipo === teamId);
            }
            return this.allCalificaciones.some(c => c.id_equipo === teamId && c.tipo === targetMision);
        },

        async init() {
            // Verificar si hay solicitud directa por URL o Hash para pruebas / IA
            if (typeof window !== 'undefined') {
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('mode') === 'test' || urlParams.get('perfil') === 'prueba' || urlParams.get('test') === 'true' || window.location.hash === '#vista-de-prueba') {
                    console.log("🤖 Activación directa de Vista de Prueba por URL / Hash...");
                    await this.loginAsVistaPrueba();
                    return;
                }
            }

            // Restaurar sesión de prueba si estaba activa y no ha expirado
            if (localStorage.getItem('tirr_test_mode') === 'true' && !isSessionExpired()) {
                console.log("🧪 Restaurando sesión de Vista de Prueba...");
                this.isTestMode = true;
                this.isAuthenticated = true;
                this.userRole = 'VISTA DE PRUEBA';
                this.user = { 
                    uid: 'tirr-test-user-vp', 
                    email: 'prueba@tirr.com', 
                    displayName: 'Vista de Prueba',
                    initial: 'VP',
                    photoURL: null
                };
                this.misionSeleccionada = localStorage.getItem('misionSeleccionada') || 'Lanzamiento Vertical';
                if (this.teams.length === 0) this.loadSampleTeams();
                if (this.allCalificaciones.length === 0) this.loadSampleCalificaciones();
                this.subscribeTeams();
                this.hideLoader();
                return;
            }

            // ── VERIFICACIÓN ESTRICTA DE EXPIRACIÓN DE SESIÓN ─────────────
            if (isSessionExpired()) {
                console.log("🔒 Sesión expirada por inactividad. Forzando login...");
                clearSessionData();
                this.misionSeleccionada = null;
                try {
                    await signOut(auth);
                } catch(e) { /* ignore */ }
            } else {
                this.misionSeleccionada = localStorage.getItem('misionSeleccionada') || null;
                touchSession();
            }

            // Sincronizar perfiles de sistema desde Firestore en tiempo real
            onSnapshot(collection(db, 'systemUsers'), (snap) => {
                const liveUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                console.log("🔄 Sincronizando perfiles desde Firestore...");

                // 1. Actualizar lista de systemUsers (usada en Login)
                this.systemUsers = this.systemUsers.map(staticUser => {
                    const dynamicUser = liveUsers.find(u => u.email && u.email.toLowerCase() === staticUser.email.toLowerCase());
                    let merged = dynamicUser ? { ...staticUser, ...dynamicUser } : staticUser;
                    
                    // Corrección explícita: Perfil Jurado 1 debe ser J1 (no J.E.D.)
                    if (merged.email.toLowerCase() === 'jurado1@tirr.com') {
                        merged.initial = 'J1';
                        if (merged.name === 'J.E.D.' || !merged.name) merged.name = 'Jurado 1';
                    }
                    return merged;
                });

                // 2. Sincronizar info del usuario logueado en tiempo real
                if (this.user) {
                    const myProfile = liveUsers.find(u => (u.email && u.email.toLowerCase() === this.user.email?.toLowerCase()) || u.id === this.user.uid);
                    if (myProfile) {
                        if (myProfile.role && myProfile.role !== this.userRole) {
                            this.userRole = myProfile.role;
                        }
                        if (myProfile.photoURL && myProfile.photoURL !== this.user.photoURL) {
                            this.user = { ...this.user, photoURL: myProfile.photoURL };
                        }
                    }
                }

                document.dispatchEvent(new CustomEvent('profiles:updated', { detail: { liveUsers } }));
            }, (err) => {
                console.warn("Firestore snapshot error (systemUsers):", err);
            });

            onAuthStateChanged(auth, async (user) => {
                console.log("Auth State Changed:", user?.email);

                // Si la sesión expiró mientras la app estaba abierta/en segundo plano
                if (user && isSessionExpired()) {
                    console.log("🔒 Sesión caducada al iniciar. Desconectando...");
                    clearSessionData();
                    this.user = null;
                    this.isAuthenticated = false;
                    this.userRole = null;
                    this.misionSeleccionada = null;
                    await signOut(auth);
                    this.hideLoader();
                    return;
                }

                this.user = user;
                this.isAuthenticated = !!user;

                if (user) {
                    touchSession();
                    // Buscar perfil extendido en Firestore
                    try {
                        const userDoc = await getDoc(doc(db, 'systemUsers', user.uid));
                        if (userDoc.exists()) {
                            const data = userDoc.data();
                            this.userRole = data.role || 'INVITADO';
                            if (data.photoURL) {
                                this.user = { ...user, photoURL: data.photoURL };
                            }
                        } else {
                            const localUser = this.systemUsers.find(u => u.email.toLowerCase() === user.email.toLowerCase());
                            this.userRole = localUser ? localUser.role : 'INVITADO';
                        }
                    } catch (e) {
                        const localUser = this.systemUsers.find(u => u.email.toLowerCase() === user.email.toLowerCase());
                        this.userRole = localUser ? localUser.role : 'INVITADO';
                    }

                    // Normalizar roles
                    if (this.userRole === 'AUX. JURADO') this.userRole = 'AUXILIAR JURADO';

                    this.subscribeTeams();
                } else {
                    if (!this.isGuest && !this.isTestMode) {
                        this.userRole = null;
                        this.teams = [];
                        this.allCalificaciones = [];
                        clearSessionData();
                        this.misionSeleccionada = null;
                    }
                }

                this.hideLoader();
            });
        },

        hideLoader() {
            setTimeout(() => {
                this.isLoadingInitial = false;
                const loader = document.getElementById('loading-screen');
                if (loader) {
                    loader.style.opacity = '0';
                    setTimeout(() => { loader.style.display = 'none'; }, 400);
                }
            }, 500);
        },

        hasAccess(module) {
            if (!this.userRole) return false;
            const role = String(this.userRole).toUpperCase().trim();

            if (role === 'ADMINISTRADOR') return true;

            // Acceso completo a módulos operativos para Vista de Prueba
            if (role === 'VISTA DE PRUEBA' || role === 'PRUEBA' || role === 'TEST' || role === 'DEMO') {
                return ['dashboard', 'registro', 'cronometro', 'calificacion', 'calificacion_lista', 'equipos', 'resultados', 'resultados_finales'].includes(module);
            }

            if (role === 'JURADO') {
                return ['dashboard', 'calificacion', 'calificacion_lista', 'equipos', 'resultados', 'resultados_finales'].includes(module);
            }

            if (role === 'AUX. JURADO' || role === 'AUXILIAR JURADO' || role === 'AUXILIAR_JURADO') {
                return ['dashboard', 'registro', 'equipos', 'resultados', 'resultados_finales'].includes(module);
            }

            if (role === 'CRONOMETRISTA') {
                return ['dashboard', 'cronometro', 'equipos', 'resultados', 'resultados_finales'].includes(module);
            }

            if (role === 'INVITADO') {
                return ['dashboard', 'equipos', 'resultados', 'resultados_finales'].includes(module);
            }

            return false;
        },

        openLogin(user) {
            this.selectedLoginUser = JSON.parse(JSON.stringify(user));
            this.loginPin = '';
            this.loginError = null;
            this.showLoginModal = true;
        },

        closeModal() {
            this.selectedTeamDetails = null;
            this.showLoginModal = false;
            this.showEditModal = false;
            this.showEditTeamModal = false;
            this.editingTeam = null;
            this.editingTeamId = null;
            this.loginPin = '';
            this.loginError = null;
        },

        setMision(m) {
            this.misionSeleccionada = m;
            if (m) {
                localStorage.setItem('misionSeleccionada', m);
                touchSession();
            } else {
                localStorage.removeItem('misionSeleccionada');
            }
        },

        async login() {
            if (!this.selectedLoginUser) return;

            // Acceso directo sin PIN obligatorio para Vista de Prueba
            if (this.selectedLoginUser.role === 'VISTA DE PRUEBA' || this.selectedLoginUser.email === 'prueba@tirr.com') {
                await this.loginAsVistaPrueba();
                this.closeModal();
                return;
            }

            if (!this.loginPin) return;
            this.loginLoading = true;
            this.loginError = null;
            try {
                // Limpiar cache local de sesiones anteriores antes de autenticar
                clearSessionData();
                this.setMision(null);
                localStorage.removeItem('activeTab');

                await signInWithEmailAndPassword(auth, this.selectedLoginUser.email, this.loginPin);
                touchSession();
                this.closeModal();
            } catch (error) {
                console.error("Error login:", error);
                this.loginError = 'PIN INCORRECTO';
                this.loginPin = '';
            } finally {
                this.loginLoading = false;
            }
        },

        async logout() {
            try {
                console.log("Cerrando sesión de forma definitiva...");
                clearSessionData();
                this.setMision(null);
                this.isGuest = false;
                this.isTestMode = false;
                this.isAuthenticated = false;
                this.userRole = null;
                this.teams = [];
                this.allCalificaciones = [];
                this.showMenu = false;

                try {
                    await signOut(auth);
                } catch(e) { /* ignore */ }

                window.location.reload();
            } catch (error) {
                console.error("Error al salir:", error);
                window.location.reload();
            }
        },

        async loginAsGuest() {
            console.log("Ingresando como Invitado...");
            // Asegurar que no quede usuario anterior en Firebase Auth
            try {
                await signOut(auth);
            } catch(e) { /* ignore */ }

            clearSessionData();
            this.isGuest = true;
            this.isTestMode = false;
            this.isAuthenticated = true;
            this.userRole = 'INVITADO';
            this.user = { email: 'invitado@tirr.com', displayName: 'Invitado' };
            this.misionSeleccionada = '__GUEST_BYPASS__';
            localStorage.setItem('activeTab', 'dashboard');
            touchSession();

            document.dispatchEvent(new CustomEvent('guest:login'));
            this.subscribeTeams();
            this.hideLoader();
        },

        async loginAsVistaPrueba() {
            console.log("🧪 Ingresando como Vista de Prueba (Modo Funcional / Auditoría IA)...");
            try {
                await signOut(auth);
            } catch(e) { /* ignore */ }

            clearSessionData();
            this.isGuest = false;
            this.isTestMode = true;
            this.isAuthenticated = true;
            this.userRole = 'VISTA DE PRUEBA';
            this.user = { 
                uid: 'tirr-test-user-vp', 
                email: 'prueba@tirr.com', 
                displayName: 'Vista de Prueba',
                initial: 'VP',
                photoURL: null
            };
            this.misionSeleccionada = 'Lanzamiento Vertical';
            localStorage.setItem('activeTab', 'dashboard');
            localStorage.setItem('tirr_test_mode', 'true');
            this.loadSampleTeams();
            this.loadSampleCalificaciones();
            touchSession();

            document.dispatchEvent(new CustomEvent('guest:login'));
            this.subscribeTeams();
            this.hideLoader();
        },

        resetTestState() {
            this.loadSampleTeams();
            this.loadSampleCalificaciones();
            alert('🔄 Entorno de prueba restablecido con datos de simulación frescos.');
        },

        loadSampleTeams() {
            this.teams = [
                {
                    id: 'test-team-01',
                    numero_registro: '01',
                    nombre_equipo: 'Apolo Robotics',
                    nombre_cohete: 'Saturno-V',
                    categoria: 'Exploradores',
                    peso_cohete: 280,
                    altura_cohete: 55,
                    diametro_cohete: 8.5,
                    miembros: ['Ana Torres', 'Carlos Pérez'],
                    tiempo_vuelo_cronometro: 14520,
                    distancia_cronometro: 42.5,
                    foto_evidencia: 'js/public/Patricinadores/Robokids.png',
                    is_test: true
                },
                {
                    id: 'test-team-02',
                    numero_registro: '02',
                    nombre_equipo: 'CyberNova Tech',
                    nombre_cohete: 'Vanguard Alpha',
                    categoria: 'Ingenieros',
                    peso_cohete: 340,
                    altura_cohete: 65,
                    diametro_cohete: 10,
                    miembros: ['Lucía Gómez', 'David Ruiz'],
                    tiempo_vuelo_cronometro: 19800,
                    distancia_cronometro: 61.2,
                    foto_evidencia: 'js/public/Patricinadores/Arcas.jpeg',
                    is_test: true
                },
                {
                    id: 'test-team-03',
                    numero_registro: '03',
                    nombre_equipo: 'Quantum Pioneers',
                    nombre_cohete: 'Cosmos IX',
                    categoria: 'Masters',
                    peso_cohete: 390,
                    altura_cohete: 72,
                    diametro_cohete: 12,
                    miembros: ['Santiago Mendoza', 'Elena Vargas'],
                    tiempo_vuelo_cronometro: 24300,
                    distancia_cronometro: 85.0,
                    foto_evidencia: 'js/public/Patricinadores/Tesum.png',
                    is_test: true
                }
            ];
        },

        loadSampleCalificaciones() {
            this.allCalificaciones = [
                // ── Misión 1: Lanzamiento Vertical ──
                {
                    id: 'test-cal-01',
                    id_equipo: 'test-team-01',
                    id_juez: 'jurado1@tirr.com',
                    nombre_juez: 'Jurado 1',
                    nombre_equipo: 'Apolo Robotics',
                    nombre_cohete: 'Saturno-V',
                    categoria: 'Exploradores',
                    ronda: 1,
                    tipo: 'Lanzamiento Vertical',
                    puntajes: { flight: 35, design: 18, innovation: 17, sustentation: 19 },
                    distancia: 0,
                    faltas: 0,
                    descalificado: false,
                    tiempo_vuelo: 14520,
                    totalScore: 89,
                    is_test: true
                },
                {
                    id: 'test-cal-02',
                    id_equipo: 'test-team-02',
                    id_juez: 'jurado1@tirr.com',
                    nombre_juez: 'Jurado 1',
                    nombre_equipo: 'CyberNova Tech',
                    nombre_cohete: 'Vanguard Alpha',
                    categoria: 'Ingenieros',
                    ronda: 1,
                    tipo: 'Lanzamiento Vertical',
                    puntajes: { flight: 38, design: 19, innovation: 18, sustentation: 18 },
                    distancia: 0,
                    faltas: 0,
                    descalificado: false,
                    tiempo_vuelo: 19800,
                    totalScore: 93,
                    is_test: true
                },
                {
                    id: 'test-cal-03',
                    id_equipo: 'test-team-03',
                    id_juez: 'jurado1@tirr.com',
                    nombre_juez: 'Jurado 1',
                    nombre_equipo: 'Quantum Pioneers',
                    nombre_cohete: 'Cosmos IX',
                    categoria: 'Masters',
                    ronda: 1,
                    tipo: 'Lanzamiento Vertical',
                    puntajes: { flight: 40, design: 20, innovation: 19, sustentation: 20 },
                    distancia: 0,
                    faltas: 0,
                    descalificado: false,
                    tiempo_vuelo: 24300,
                    totalScore: 99,
                    is_test: true
                },
                // ── Misión 2: Tiro Parabólico (Para podio y resultados combinados) ──
                {
                    id: 'test-cal-04',
                    id_equipo: 'test-team-01',
                    id_juez: 'jurado1@tirr.com',
                    nombre_juez: 'Jurado 1',
                    nombre_equipo: 'Apolo Robotics',
                    nombre_cohete: 'Saturno-V',
                    categoria: 'Exploradores',
                    ronda: 1,
                    tipo: 'Tiro Parabólico',
                    puntajes: { flight: 36, design: 18, innovation: 18, sustentation: 19 },
                    distancia: 42.5,
                    faltas: 0,
                    descalificado: false,
                    tiempo_vuelo: 14520,
                    totalScore: 91,
                    is_test: true
                },
                {
                    id: 'test-cal-05',
                    id_equipo: 'test-team-02',
                    id_juez: 'jurado1@tirr.com',
                    nombre_juez: 'Jurado 1',
                    nombre_equipo: 'CyberNova Tech',
                    nombre_cohete: 'Vanguard Alpha',
                    categoria: 'Ingenieros',
                    ronda: 1,
                    tipo: 'Tiro Parabólico',
                    puntajes: { flight: 39, design: 19, innovation: 18, sustentation: 19 },
                    distancia: 61.2,
                    faltas: 0,
                    descalificado: false,
                    tiempo_vuelo: 19800,
                    totalScore: 95,
                    is_test: true
                },
                {
                    id: 'test-cal-06',
                    id_equipo: 'test-team-03',
                    id_juez: 'jurado1@tirr.com',
                    nombre_juez: 'Jurado 1',
                    nombre_equipo: 'Quantum Pioneers',
                    nombre_cohete: 'Cosmos IX',
                    categoria: 'Masters',
                    ronda: 1,
                    tipo: 'Tiro Parabólico',
                    puntajes: { flight: 40, design: 20, innovation: 20, sustentation: 18 },
                    distancia: 85.0,
                    faltas: 0,
                    descalificado: false,
                    tiempo_vuelo: 24300,
                    totalScore: 98,
                    is_test: true
                }
            ];
        },

        subscribeTeams() {
            const q = query(collection(db, 'equipos'), orderBy('createdAt', 'desc'));
            onSnapshot(q, (snap) => {
                let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

                // Ordenar numéricamente por número de registro o fecha
                list.sort((a, b) => {
                    const numA = parseInt(a.numero_registro || 9999, 10);
                    const numB = parseInt(b.numero_registro || 9999, 10);
                    if (numA !== numB) return numA - numB;
                    const tA = a.createdAt?.seconds || 0;
                    const tB = b.createdAt?.seconds || 0;
                    return tA - tB;
                });

                if (this.isTestMode) {
                    if (this.teams.length === 0) {
                        this.loadSampleTeams();
                    }
                    return;
                }
                this.teams = list;
            }, (err) => {
                console.warn("Firestore snapshot error (equipos):", err);
                if (this.isTestMode && this.teams.length === 0) {
                    this.loadSampleTeams();
                }
            });

            // Suscribirse a calificaciones globalmente para estados y badges
            onSnapshot(collection(db, 'calificaciones'), (snap) => {
                const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                if (this.isTestMode) {
                    if (this.allCalificaciones.length === 0) {
                        this.loadSampleCalificaciones();
                    }
                    return;
                }
                this.allCalificaciones = list;
            }, (err) => {
                console.warn("Firestore snapshot error (calificaciones):", err);
                if (this.isTestMode && this.allCalificaciones.length === 0) {
                    this.loadSampleCalificaciones();
                }
            });
        },

        openEditTeamModal(team) {
            this.editingTeam = JSON.parse(JSON.stringify(team));
            this.showEditTeamModal = true;
        },

        async updateTeam() {
            if (!this.editingTeam?.id) return;

            const editPeso = Number(this.editingTeam.peso_cohete);
            const editAltura = Number(this.editingTeam.altura_cohete);
            const editDiametro = Number(this.editingTeam.diametro_cohete);

            if (isNaN(editPeso) || editPeso <= 0 || editPeso > 400) {
                return alert('❌ ERROR: El peso debe ser un número mayor a 0 y máximo 400g.');
            }
            if (isNaN(editAltura) || editAltura <= 0 || editAltura > 75) {
                return alert('❌ ERROR: La altura debe ser un número mayor a 0 y máximo 75cm.');
            }
            if (isNaN(editDiametro) || editDiametro <= 0 || editDiametro > 12.5) {
                return alert('❌ ERROR: El diámetro debe ser un número mayor a 0 y máximo 12.5cm.');
            }

            if (this.isTestMode) {
                const idx = this.teams.findIndex(t => t.id === this.editingTeam.id);
                if (idx >= 0) {
                    this.teams[idx] = { ...this.teams[idx], ...this.editingTeam };
                }
                alert('✅ [VISTA DE PRUEBA] Equipo actualizado en la sesión de prueba.');
                this.showEditTeamModal = false;
                this.editingTeam = null;
                this.editMemberInput = '';
                return;
            }
            try {
                const id = this.editingTeam.id;
                const updatePayload = {
                    nombre_equipo: this.editingTeam.nombre_equipo || '',
                    nombre_cohete: this.editingTeam.nombre_cohete || '',
                    categoria: this.editingTeam.categoria || 'Exploradores',
                    numero_registro: String(this.editingTeam.numero_registro || '').padStart(2, '0'),
                    peso_cohete: Number(this.editingTeam.peso_cohete),
                    altura_cohete: Number(this.editingTeam.altura_cohete),
                    diametro_cohete: Number(this.editingTeam.diametro_cohete),
                    miembros: Array.isArray(this.editingTeam.miembros) ? this.editingTeam.miembros : [],
                    updatedAt: serverTimestamp()
                };

                await updateDoc(doc(db, 'equipos', id), updatePayload);
                alert('✅ Equipo actualizado correctamente.');
                this.showEditTeamModal = false;
                this.editingTeam = null;
                this.editMemberInput = '';
            } catch (error) {
                console.error("Error al actualizar equipo:", error);
                alert('❌ Error al actualizar equipo: ' + error.message);
            }
        },

        closeEditTeamModal() {
            this.showEditTeamModal = false;
            this.editingTeam = null;
            this.editMemberInput = '';
        },

        addEditMember() {
            if (!this.editMemberInput || !this.editMemberInput.trim()) return;
            if (!this.editingTeam) return;
            if (!this.editingTeam.miembros) this.editingTeam.miembros = [];
            this.editingTeam.miembros.push(this.editMemberInput.trim().toUpperCase());
            this.editMemberInput = '';
        },

        removeEditMember(index) {
            if (this.editingTeam?.miembros) {
                this.editingTeam.miembros.splice(index, 1);
            }
        },

        async deleteTeam(id) {
            if (!confirm('¿Estás seguro de que deseas eliminar este equipo? Esta acción no se puede deshacer.')) return;
            if (this.isTestMode) {
                this.teams = this.teams.filter(t => t.id !== id);
                alert('✅ [VISTA DE PRUEBA] Equipo eliminado de la sesión de prueba.');
                return;
            }
            try {
                await deleteDoc(doc(db, 'equipos', id));
                alert('✅ Equipo eliminado correctamente.');
            } catch (error) {
                console.error("Error al eliminar equipo:", error);
                alert('❌ Error al eliminar el equipo: ' + error.message);
            }
        }
    });

    // ── Component: Cronometrista ──────────────────────────────
    Alpine.data('cronometro', () => ({
        selectedTeamId: null,
        categoriaFiltro: 'TODAS',
        running: false,
        time_ms: 0,
        startTime: 0,
        intervalId: null,
        distancia: 0,
        guardado: false,
        tiempoManualSec: '', // Campo para ingreso manual
        fallosReportados: 0, // Fallos reportados en vivo hacia los jueces

        get selectedTeam() {
            return Alpine.store('app').teams.find(t => t.id === this.selectedTeamId);
        },

        init() {
            this.$watch('selectedTeamId', (newId) => {
                this.time_ms = 0;
                this.distancia = 0;
                this.tiempoManualSec = '';
                this.fallosReportados = 0;
                this.running = false;
                this.guardado = false;
                if (this.intervalId) clearInterval(this.intervalId);

                if (newId) {
                    console.log("Sincronizando equipo en cronómetro:", newId);
                    // Cargar tiempo o distancia previa si ya existía en el equipo
                    if (this.selectedTeam) {
                        if (this.selectedTeam.tiempo_vuelo_cronometro) {
                            this.time_ms = this.selectedTeam.tiempo_vuelo_cronometro;
                            this.tiempoManualSec = (this.time_ms / 1000).toFixed(2);
                        }
                        if (this.selectedTeam.distancia_cronometro) {
                            this.distancia = this.selectedTeam.distancia_cronometro;
                        }
                    }
                    this.syncToRTDB();
                }
            });

            this.$watch('distancia', () => {
                if (Alpine.store('app').misionSeleccionada === 'Tiro Parabólico' && this.selectedTeamId && !this.guardado) {
                    this.syncToRTDB();
                }
            });
        },

        get filteredTeams() {
            const teams = Alpine.store('app').teams;
            if (this.categoriaFiltro === 'TODAS' || this.categoriaFiltro === 'Todos') return teams;
            return teams.filter(t => Alpine.store('app').matchesCategoria(t.categoria, this.categoriaFiltro));
        },

        get formatted() {
            const minutes = Math.floor(this.time_ms / 60000);
            const seconds = Math.floor((this.time_ms % 60000) / 1000);
            const centiseconds = Math.floor((this.time_ms % 1000) / 10);
            return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}.${String(centiseconds).padStart(2,'0')}`;
        },

        // Aplicar tiempo escrito a mano por el cronometrista
        aplicarTiempoManual() {
            if (!this.selectedTeam) return alert('Selecciona un equipo primero');
            const sec = parseFloat(this.tiempoManualSec);
            if (isNaN(sec) || sec < 0) {
                return alert('Por favor, ingresa un número de segundos válido');
            }
            this.time_ms = Math.round(sec * 1000);
            this.guardado = true;
            if (Alpine.store('app').isTestMode) {
                this.selectedTeam.tiempo_vuelo_cronometro = this.time_ms;
                alert(`✅ [VISTA DE PRUEBA] Tiempo manual fijado: ${sec.toFixed(2)}s.`);
                return;
            }
            this.syncToRTDB(true);
            this.persistirTiempoEnFirestore();
            alert(`✅ Tiempo manual fijado: ${sec.toFixed(2)}s y respaldado en la base de datos.`);
        },

        // Reporte de faltas/fallos en vivo hacia los jueces vía RTDB
        async reportarFallo() {
            if (!this.selectedTeam) return alert('Selecciona un equipo primero');
            this.fallosReportados++;
            if (Alpine.store('app').isTestMode) {
                alert(`⚠️ [VISTA DE PRUEBA] Fallo reportado (#${this.fallosReportados}) para ${this.selectedTeam.nombre_equipo}.`);
                return;
            }
            const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const missionPath = mision.replace(/\s+/g, '_').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            const launchRef = ref(rtdb, `active_launch_${missionPath}/${this.selectedTeam.id}`);
            await update(launchRef, {
                fallos_cronometro: this.fallosReportados,
                alerta_fallo_ts: Date.now()
            });
        },

        async start() {
            if (!this.selectedTeam) return alert('Selecciona un equipo primero');
            this.running = true;
            this.startTime = Date.now() - this.time_ms;
            let lastSync = 0;
            this.intervalId = setInterval(() => {
                this.time_ms = Date.now() - this.startTime;
                this.tiempoManualSec = (this.time_ms / 1000).toFixed(2);

                if (Date.now() - lastSync > 150) {
                    this.syncToRTDB();
                    lastSync = Date.now();
                }
            }, 50);
        },

        async stop() {
            this.running = false;
            clearInterval(this.intervalId);
            this.time_ms = Date.now() - this.startTime;
            this.tiempoManualSec = (this.time_ms / 1000).toFixed(2);
            this.syncToRTDB(true);
            // Autoguardado inmediato en Firestore para evitar pérdida si el jurado no llena a tiempo
            this.persistirTiempoEnFirestore();
        },

        async reset() {
            if (this.running) this.stop();
            this.time_ms = 0;
            this.distancia = 0;
            this.tiempoManualSec = '';
            this.fallosReportados = 0;
            this.guardado = false;
            this.syncToRTDB();
        },

        async guardar() {
            if (!this.selectedTeam) return alert('Selecciona un equipo primero');
            if (this.running) this.stop();
            this.guardado = true;
            if (Alpine.store('app').isTestMode) {
                this.selectedTeam.tiempo_vuelo_cronometro = this.time_ms;
                if (this.distancia > 0) this.selectedTeam.distancia_cronometro = this.distancia;
                alert('✅ [VISTA DE PRUEBA] Registro cronometrado asegurado en sesión de prueba.');
                return;
            }
            this.syncToRTDB(true);
            await this.persistirTiempoEnFirestore();
            alert('✅ Registro cronometrado asegurado en base de datos.');
        },

        editar() {
            this.guardado = false;
            this.syncToRTDB(false);
        },

        // Guarda automáticamente en el documento del equipo en Firestore
        async persistirTiempoEnFirestore() {
            if (Alpine.store('app').isTestMode) return;
            if (!this.selectedTeam) return;
            try {
                const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
                await updateDoc(doc(db, 'equipos', this.selectedTeam.id), {
                    tiempo_vuelo_cronometro: Number(this.time_ms || 0),
                    distancia_cronometro: Number(this.distancia || 0),
                    mision_cronometro: mision,
                    updated_cronometro_at: serverTimestamp()
                });
                console.log("⏱️ Tiempo respaldado en Firestore para:", this.selectedTeam.id);
            } catch(e) {
                console.warn("No se pudo respaldar tiempo en Firestore (permisos o red):", e);
            }
        },

        syncToRTDB(isFinal = false) {
            if (Alpine.store('app').isTestMode || Alpine.store('app').isGuest) return;
            if (!this.selectedTeam) return;

            const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const missionPath = mision.replace(/\s+/g, '_').normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            const launchRef = ref(rtdb, `active_launch_${missionPath}/${this.selectedTeam.id}`);
            set(launchRef, {
                running: this.running,
                time_ms: this.time_ms,
                distancia: Number(this.distancia || 0),
                mision: mision,
                nombre_equipo: this.selectedTeam.nombre_equipo,
                categoria: this.selectedTeam.categoria,
                fallos_cronometro: this.fallosReportados,
                is_final: isFinal,
                updatedAt: Date.now()
            });
        }
    }));

    // ── Component: Jurado (Evaluación Individual Clásica con Separación de Jueces) ──
    Alpine.data('calificacionJurado', () => ({
        selectedTeamId: null,
        categoriaFiltro: 'TODAS',
        soloPendientes: false,
        launchData: { running: false, time_ms: 0, fallos_cronometro: 0 },
        scores: { flight: 0, design: 0, innovation: 0, sustentation: 0 },
        distancia: 0,
        penalties: 0,
        equipoDescalificado: false,
        round: 1,
        isSubmitting: false,
        currentCalificacionId: null,
        alertaFalloVisible: false,

        get selectedTeam() {
            return Alpine.store('app').teams.find(t => t.id === this.selectedTeamId);
        },

        get filteredTeams() {
            let teams = Alpine.store('app').teams;
            if (this.categoriaFiltro !== 'TODAS' && this.categoriaFiltro !== 'Todos') {
                teams = teams.filter(t => Alpine.store('app').matchesCategoria(t.categoria, this.categoriaFiltro));
            }
            if (this.soloPendientes) {
                const currentJudgeId = Alpine.store('app').currentJudgeId;
                const mision = Alpine.store('app').misionSeleccionada;
                teams = teams.filter(t => {
                    return !Alpine.store('app').allCalificaciones.some(c => 
                        c.id_equipo === t.id && c.tipo === mision && c.id_juez === currentJudgeId
                    );
                });
            }
            return teams;
        },

        get total() {
            if (this.equipoDescalificado) return 0;
            const base = (Number(this.scores.flight) || 0) + (Number(this.scores.design) || 0) + 
                         (Number(this.scores.innovation) || 0) + (Number(this.scores.sustentation) || 0);
            return Math.max(0, base - (Number(this.penalties) || 0));
        },

        init() {
            this.$watch('scores.flight', val => { if(val !== '' && val !== null) this.scores.flight = Math.min(40, Math.max(0, val)); });
            this.$watch('scores.design', val => { if(val !== '' && val !== null) this.scores.design = Math.min(20, Math.max(0, val)); });
            this.$watch('scores.innovation', val => { if(val !== '' && val !== null) this.scores.innovation = Math.min(20, Math.max(0, val)); });
            this.$watch('scores.sustentation', val => { if(val !== '' && val !== null) this.scores.sustentation = Math.min(20, Math.max(0, val)); });
            this.$watch('penalties', val => { if(val !== '' && val !== null) this.penalties = Math.max(0, val); });

            this.$watch('selectedTeamId', async (id) => {
                if (id) {
                    console.log("Jurado evaluando equipo:", id);
                    this.listenToLaunch(id);
                    await this.loadExistingCalificacion(id);
                } else {
                    this.launchData = { running: false, time_ms: 0, fallos_cronometro: 0 };
                    this.currentCalificacionId = null;
                    this.alertaFalloVisible = false;
                }
            });
        },

        incrementPenalty() {
            this.penalties++;
        },

        decrementPenalty() {
            if (this.penalties > 0) this.penalties--;
        },

        aplicarFalloCronometro() {
            if (this.launchData?.fallos_cronometro > 0) {
                this.penalties = Math.max(this.penalties, this.launchData.fallos_cronometro);
                this.alertaFalloVisible = false;
            }
        },

        listenToLaunch(teamId) {
            if (this.unsubscribeLaunch) this.unsubscribeLaunch();

            const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const missionPath = mision.replace(/\s+/g, '_').normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            const launchRef = ref(rtdb, `active_launch_${missionPath}/${teamId}`);
            this.unsubscribeLaunch = onValue(launchRef, (snap) => {
                if (snap.exists()) {
                    this.launchData = snap.val();
                    if (mision === 'Tiro Parabólico') {
                        this.distancia = this.launchData.distancia || 0;
                    }
                    if (this.launchData.fallos_cronometro > 0 && this.launchData.fallos_cronometro > this.penalties) {
                        this.alertaFalloVisible = true;
                    }
                } else {
                    this.launchData = { running: false, time_ms: 0, distancia: 0, fallos_cronometro: 0 };
                    if (mision === 'Tiro Parabólico') this.distancia = 0;
                    this.alertaFalloVisible = false;
                }
            });
        },

        async save() {
            if (!this.selectedTeam && !this.selectedTeamId) return;
            this.isSubmitting = true;
            try {
                const nombreE = this.selectedTeam?.nombre_equipo || this.launchData?.nombre_equipo || 'Equipo Desconocido';
                const nombreC = this.selectedTeam?.nombre_cohete || this.launchData?.nombre_cohete || 'Cohete Desconocido';
                const cat = this.selectedTeam?.categoria || this.launchData?.categoria || 'Sin Categoría';
                const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';

                const calData = {
                    id_equipo: this.selectedTeamId,
                    id_juez: Alpine.store('app').currentJudgeId,
                    nombre_juez: Alpine.store('app').currentJudgeName,
                    nombre_equipo: nombreE,
                    nombre_cohete: nombreC,
                    categoria: cat,
                    ronda: Number(this.round),
                    tipo: mision,
                    puntajes: {
                        flight: Number(this.scores.flight || 0),
                        design: Number(this.scores.design || 0),
                        innovation: Number(this.scores.innovation || 0),
                        sustentation: Number(this.scores.sustentation || 0)
                    },
                    distancia: mision === 'Tiro Parabólico' ? Number(this.distancia || 0) : 0,
                    faltas: Number(this.penalties || 0),
                    descalificado: this.equipoDescalificado,
                    tiempo_vuelo: Number(this.launchData.time_ms || this.selectedTeam?.tiempo_vuelo_cronometro || 0),
                    totalScore: Number(this.total),
                    createdAt: serverTimestamp()
                };

                if (Alpine.store('app').isTestMode) {
                    const mockCal = {
                        id: this.currentCalificacionId || ('mock-cal-' + this.selectedTeamId),
                        ...calData,
                        createdAt: { seconds: Math.floor(Date.now() / 1000) },
                        is_test: true
                    };
                    const existingIdx = Alpine.store('app').allCalificaciones.findIndex(c => 
                        c.id_equipo === this.selectedTeamId && 
                        c.id_juez === Alpine.store('app').currentJudgeId && 
                        c.tipo === mision
                    );
                    if (existingIdx >= 0) {
                        Alpine.store('app').allCalificaciones[existingIdx] = mockCal;
                        Alpine.store('app').allCalificaciones = [...Alpine.store('app').allCalificaciones];
                    } else {
                        Alpine.store('app').allCalificaciones = [...Alpine.store('app').allCalificaciones, mockCal];
                    }
                    alert(`✅ [VISTA DE PRUEBA] Calificación simulada guardada con éxito (Puntaje Total: ${this.total}).`);
                    this.resetForm();
                    if (Alpine.store('app').showEditModal) {
                        Alpine.store('app').closeModal();
                    }
                    return;
                }

                if (this.currentCalificacionId) {
                    await updateDoc(doc(db, 'calificaciones', this.currentCalificacionId), calData);
                } else {
                    const docAdded = await addDoc(collection(db, 'calificaciones'), calData);
                    this.currentCalificacionId = docAdded.id;
                }

                alert('✅ Calificación guardada exitosamente.');
                this.resetForm();
                if (Alpine.store('app').showEditModal) {
                    Alpine.store('app').closeModal();
                }
            } catch (err) {
                console.error(err);
                alert('❌ Error al guardar: ' + err.message);
            } finally {
                this.isSubmitting = false;
            }
        },

        // Carga únicamente la calificación guardada por este juez en esta misión
        async loadExistingCalificacion(teamId) {
            const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const currentJudgeId = Alpine.store('app').currentJudgeId;

            if (Alpine.store('app').isTestMode) {
                const found = Alpine.store('app').allCalificaciones.find(c => 
                    c.id_equipo === teamId && 
                    c.id_juez === currentJudgeId && 
                    c.tipo === mision
                );
                if (found) {
                    this.currentCalificacionId = found.id;
                    this.scores = found.puntajes || { flight: 0, design: 0, innovation: 0, sustentation: 0 };
                    this.penalties = found.faltas || 0;
                    this.equipoDescalificado = found.descalificado || false;
                    this.distancia = found.distancia || 0;
                } else {
                    this.currentCalificacionId = null;
                    this.scores = { flight: 0, design: 0, innovation: 0, sustentation: 0 };
                    this.penalties = 0;
                    this.equipoDescalificado = false;
                }
                return;
            }

            try {
                const qDocs = query(
                    collection(db, 'calificaciones'),
                    where('id_equipo', '==', teamId),
                    where('tipo', '==', mision),
                    where('id_juez', '==', currentJudgeId)
                );

                const querySnapshot = await getDocs(qDocs);
                let latestDoc = null;

                querySnapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    const docTime = data.createdAt?.seconds || 0;
                    const latestTime = latestDoc?.createdAt?.seconds || 0;

                    if (!latestDoc || docTime >= latestTime) {
                        latestDoc = { id: docSnap.id, ...data };
                    }
                });

                if (latestDoc) {
                    this.currentCalificacionId = latestDoc.id;
                    this.scores = latestDoc.puntajes || { flight: 0, design: 0, innovation: 0, sustentation: 0 };
                    this.penalties = latestDoc.faltas || 0;
                    this.equipoDescalificado = latestDoc.descalificado || false;
                    if (latestDoc.distancia && !this.distancia) {
                        this.distancia = latestDoc.distancia;
                    }
                    if (latestDoc.tiempo_vuelo && (!this.launchData || !this.launchData.time_ms)) {
                        this.launchData = { ...this.launchData, time_ms: latestDoc.tiempo_vuelo, running: false };
                    }
                } else {
                    this.currentCalificacionId = null;
                    this.scores = { flight: 0, design: 0, innovation: 0, sustentation: 0 };
                    this.penalties = 0;
                    this.equipoDescalificado = false;
                }
            } catch (err) {
                console.error("Error cargando calificación existente:", err);
            }
        },

        resetForm() {
            this.scores = { flight: 0, design: 0, innovation: 0, sustentation: 0 };
            this.distancia = 0;
            this.penalties = 0;
            this.equipoDescalificado = false;
            this.selectedTeamId = null;
            this.currentCalificacionId = null;
            this.alertaFalloVisible = false;
        }
    }));

    // ── Component: Calificación Tipo Lista (5 Casillas Continuas) ───────────
    // Casillas: Vuelo (40), Diseño (20), Innovación (20), Sustentación (20), Penalizaciones / Fallos
    Alpine.data('calificacionListaController', () => ({
        filtroCategoria: 'TODAS',
        soloPendientes: false,
        calificacionesData: {}, // { [teamId]: { flight, design, innovation, sustentation, penalties, descalificado, id_doc, status } }
        alertasFallosRTDB: {},  // { [teamId]: count }
        searchQuery: '',

        init() {
            // Cargar calificaciones existentes para el jurado activo en la misión actual
            this.cargarCalificacionesDelJuez();

            this.$watch('$store.app.misionSeleccionada', () => {
                this.cargarCalificacionesDelJuez();
            });

            this.$watch('$store.app.allCalificaciones', () => {
                this.cargarCalificacionesDelJuez();
            });

            // Escuchar alertas de fallos en vivo desde RTDB para la misión
            this.escucharAlertasFallos();
        },

        escucharAlertasFallos() {
            const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const missionPath = mision.replace(/\s+/g, '_').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const launchesRef = ref(rtdb, `active_launch_${missionPath}`);

            onValue(launchesRef, (snap) => {
                if (snap.exists()) {
                    const data = snap.val();
                    const newAlerts = {};
                    Object.keys(data).forEach(teamId => {
                        if (data[teamId]?.fallos_cronometro > 0) {
                            newAlerts[teamId] = data[teamId].fallos_cronometro;
                        }
                    });
                    this.alertasFallosRTDB = newAlerts;
                }
            });
        },

        cargarCalificacionesDelJuez() {
            const judgeId = Alpine.store('app').currentJudgeId;
            const mision = Alpine.store('app').misionSeleccionada;
            const cals = Alpine.store('app').allCalificaciones.filter(c => c.id_juez === judgeId && c.tipo === mision);

            // Intentar recuperar borrador offline de localStorage primero
            const draftKey = `tirr_draft_${judgeId}_${mision}`;
            let drafts = {};
            try {
                drafts = JSON.parse(localStorage.getItem(draftKey) || '{}');
            } catch(e) {}

            const map = {};
            Alpine.store('app').teams.forEach(team => {
                const found = cals.find(c => c.id_equipo === team.id);
                const draft = drafts[team.id];

                if (found) {
                    map[team.id] = {
                        flight: found.puntajes?.flight ?? 0,
                        design: found.puntajes?.design ?? 0,
                        innovation: found.puntajes?.innovation ?? 0,
                        sustentation: found.puntajes?.sustentation ?? 0,
                        penalties: found.faltas ?? 0,
                        descalificado: found.descalificado ?? false,
                        id_doc: found.id,
                        status: 'saved', // 'saved' | 'saving' | 'dirty'
                        evaluado: true
                    };
                } else if (draft) {
                    map[team.id] = {
                        ...draft,
                        id_doc: null,
                        status: 'dirty',
                        evaluado: false
                    };
                } else {
                    map[team.id] = {
                        flight: 0,
                        design: 0,
                        innovation: 0,
                        sustentation: 0,
                        penalties: 0,
                        descalificado: false,
                        id_doc: null,
                        status: 'empty',
                        evaluado: false
                    };
                }
            });

            this.calificacionesData = map;
        },

        getRow(teamId) {
            if (!this.calificacionesData[teamId]) {
                this.calificacionesData[teamId] = {
                    flight: 0, design: 0, innovation: 0, sustentation: 0, penalties: 0,
                    descalificado: false, id_doc: null, status: 'empty', evaluado: false
                };
            }
            return this.calificacionesData[teamId];
        },

        calculateTotal(teamId) {
            const row = this.getRow(teamId);
            if (row.descalificado) return 0;
            const base = (Number(row.flight) || 0) + (Number(row.design) || 0) + 
                         (Number(row.innovation) || 0) + (Number(row.sustentation) || 0);
            return Math.max(0, base - (Number(row.penalties) || 0));
        },

        // Aplicar fallo reportado por el cronometrista a la fila
        aplicarFalloCronometroRow(teamId) {
            const count = this.alertasFallosRTDB[teamId];
            if (count > 0) {
                const row = this.getRow(teamId);
                row.penalties = Math.max(Number(row.penalties || 0), count);
                this.saveRow(teamId);
            }
        },

        // Autoguardado reactivo al salir de la casilla (blur) o al cambiar valor (change)
        async saveRow(teamId) {
            const team = Alpine.store('app').teams.find(t => t.id === teamId);
            if (!team) return;

            const row = this.getRow(teamId);
            row.status = 'saving';

            // Validar límites
            row.flight = Math.min(40, Math.max(0, Number(row.flight) || 0));
            row.design = Math.min(20, Math.max(0, Number(row.design) || 0));
            row.innovation = Math.min(20, Math.max(0, Number(row.innovation) || 0));
            row.sustentation = Math.min(20, Math.max(0, Number(row.sustentation) || 0));
            row.penalties = Math.max(0, Number(row.penalties) || 0);

            const total = this.calculateTotal(teamId);
            const mision = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const judgeId = Alpine.store('app').currentJudgeId;
            const judgeName = Alpine.store('app').currentJudgeName;

            // Guardar borrador en localStorage de respaldo
            try {
                const draftKey = `tirr_draft_${judgeId}_${mision}`;
                const drafts = JSON.parse(localStorage.getItem(draftKey) || '{}');
                drafts[teamId] = { ...row };
                localStorage.setItem(draftKey, JSON.stringify(drafts));
            } catch(e) {}

            const calData = {
                id_equipo: team.id,
                id_juez: judgeId,
                nombre_juez: judgeName,
                nombre_equipo: team.nombre_equipo || 'Equipo',
                nombre_cohete: team.nombre_cohete || 'Cohete',
                categoria: team.categoria || 'Sin Categoría',
                ronda: 1,
                tipo: mision,
                puntajes: {
                    flight: Number(row.flight),
                    design: Number(row.design),
                    innovation: Number(row.innovation),
                    sustentation: Number(row.sustentation)
                },
                distancia: Number(team.distancia_cronometro || 0),
                faltas: Number(row.penalties),
                descalificado: !!row.descalificado,
                tiempo_vuelo: Number(team.tiempo_vuelo_cronometro || 0),
                totalScore: Number(total),
                createdAt: serverTimestamp()
            };

            if (Alpine.store('app').isTestMode) {
                setTimeout(() => {
                    row.status = 'saved';
                    row.evaluado = true;
                    const existingCalIdx = Alpine.store('app').allCalificaciones.findIndex(c => c.id_equipo === teamId && c.id_juez === Alpine.store('app').currentJudgeId && c.tipo === mision);
                    const mockCal = {
                        id: row.id_doc || ('mock-cal-' + teamId),
                        id_equipo: teamId,
                        id_juez: Alpine.store('app').currentJudgeId,
                        nombre_juez: Alpine.store('app').currentJudgeName,
                        nombre_equipo: team.nombre_equipo || 'Cohete',
                        nombre_cohete: team.nombre_cohete || 'Cohete',
                        categoria: team.categoria || 'Exploradores',
                        ronda: 1,
                        tipo: mision,
                        puntajes: {
                            flight: Number(row.flight),
                            design: Number(row.design),
                            innovation: Number(row.innovation),
                            sustentation: Number(row.sustentation)
                        },
                        distancia: Number(team.distancia_cronometro || 0),
                        faltas: Number(row.penalties),
                        descalificado: !!row.descalificado,
                        tiempo_vuelo: Number(team.tiempo_vuelo_cronometro || 0),
                        totalScore: Number(total),
                        is_test: true,
                        createdAt: { seconds: Math.floor(Date.now() / 1000) }
                    };
                    if (existingCalIdx >= 0) {
                        Alpine.store('app').allCalificaciones[existingCalIdx] = mockCal;
                    } else {
                        Alpine.store('app').allCalificaciones.push(mockCal);
                    }
                    console.log("🧪 [VISTA DE PRUEBA] Fila autoguardada localmente:", team.nombre_equipo, "Puntaje:", total);
                }, 100);
                return;
            }

            try {
                if (row.id_doc) {
                    await updateDoc(doc(db, 'calificaciones', row.id_doc), calData);
                } else {
                    const docRef = await addDoc(collection(db, 'calificaciones'), calData);
                    row.id_doc = docRef.id;
                }
                row.status = 'saved';
                row.evaluado = true;
            } catch (err) {
                console.error("Error autoguardando fila de jurado:", err);
                row.status = 'error';
            }
        },

        get visibleTeams() {
            let list = Alpine.store('app').teams;

            // Filtro de Categoría normalizado
            if (this.filtroCategoria !== 'TODAS' && this.filtroCategoria !== 'Todos') {
                list = list.filter(t => Alpine.store('app').matchesCategoria(t.categoria, this.filtroCategoria));
            }

            // Filtro "Sacar automáticamente a los calificados" (Solo Pendientes)
            if (this.soloPendientes) {
                list = list.filter(t => !this.getRow(t.id).evaluado);
            }

            // Filtro por búsqueda de texto
            if (this.searchQuery.trim()) {
                const q = this.searchQuery.trim().toLowerCase();
                list = list.filter(t => 
                    (t.nombre_equipo && t.nombre_equipo.toLowerCase().includes(q)) ||
                    (t.nombre_cohete && t.nombre_cohete.toLowerCase().includes(q)) ||
                    (t.numero_registro && String(t.numero_registro).includes(q))
                );
            }

            return list;
        }
    }));

    // ── Component: Login Precargado ───────────────────────────
    Alpine.data('loginController', () => ({
        usuarios: [
            { id: 1, nombre: 'Admin TIRR', rol: 'ADMINISTRADOR', email: 'admin@tirr.com', hex: '#D30000', color: 'red', initial: 'AT' },
            { id: 2, nombre: 'Jurado 1', rol: 'JURADO', email: 'jurado1@tirr.com', hex: '#FFD700', color: 'yellow', initial: 'J1' },
            { id: 3, nombre: 'Jurado 2', rol: 'JURADO', email: 'jurado2@tirr.com', hex: '#FFD700', color: 'yellow', initial: 'J2' },
            { id: 4, nombre: 'Jurado 3', rol: 'JURADO', email: 'jurado3@tirr.com', hex: '#FFD700', color: 'yellow', initial: 'J3' },
            { id: 5, nombre: 'Jurado 4', rol: 'JURADO', email: 'jurado4@tirr.com', hex: '#FFD700', color: 'yellow', initial: 'J4' },
            { id: 6, nombre: 'Auxiliar 1', rol: 'AUXILIAR JURADO', email: 'auxiliar1@tirr.com', hex: '#10B981', color: 'emerald', initial: 'A1' },
            { id: 7, nombre: 'Auxiliar 2', rol: 'AUXILIAR JURADO', email: 'auxiliar2@tirr.com', hex: '#10B981', color: 'emerald', initial: 'A2' },
            { id: 8, nombre: 'Cronometrista', rol: 'CRONOMETRISTA', email: 'cronometrista1@tirr.com', hex: '#00E5FF', color: 'cyan', initial: 'C1' },
            { id: 9, nombre: 'Vista de Prueba', rol: 'VISTA DE PRUEBA', email: 'prueba@tirr.com', hex: '#A855F7', color: 'purple', initial: 'VP' }
        ],
        usuarioActivo: null,
        password: '',
        isLoading: false,
        errorMsg: '',

        seleccionarUsuario(user) {
            this.errorMsg = '';
            this.password = '';
            this.usuarioActivo = user;
        },

        cancelarLogin() {
            this.usuarioActivo = null;
            this.password = '';
            this.errorMsg = '';
        },

        async iniciarSesion() {
            if (!this.password) {
                this.errorMsg = 'Debes ingresar una contraseña';
                return;
            }
            this.isLoading = true;
            this.errorMsg = '';

            try {
                clearSessionData();
                await signInWithEmailAndPassword(auth, this.usuarioActivo.email, this.password);
                touchSession();
            } catch (error) {
                console.error(error);
                this.errorMsg = 'Contraseña incorrecta o error de conexión.';
            } finally {
                this.isLoading = false;
            }
        }
    }));

    // ── Component: Registro de Equipos ────────────────────────
    Alpine.data('registroController', () => ({
        form: {
            numero_registro: '',
            nombre_equipo: '',
            nombre_cohete: '',
            categoria: 'Exploradores',
            peso_cohete: '',
            altura_cohete: '',
            diametro_cohete: '',
            miembros: []
        },

        nuevoMiembro: '',
        fotoFile: null,
        isSubmitting: false,

        init() {
            this.calcularSiguienteNumero();
            this.$watch('$store.app.teams', () => {
                if (!this.form.numero_registro) this.calcularSiguienteNumero();
            });
        },

        calcularSiguienteNumero() {
            const next = (Alpine.store('app').teams.length + 1);
            this.form.numero_registro = String(next).padStart(2, '0');
        },

        resetForm() {
            this.form = {
                numero_registro: '',
                nombre_equipo: '',
                nombre_cohete: '',
                categoria: 'Exploradores',
                peso_cohete: '',
                altura_cohete: '',
                diametro_cohete: '',
                miembros: []
            };
            this.calcularSiguienteNumero();
            this.nuevoMiembro = '';
            this.fotoFile = null;
            const fileInput = document.getElementById('foto_cohete');
            if(fileInput) fileInput.value = '';
        },

        addMiembro() {
            if (this.nuevoMiembro.trim()) {
                this.form.miembros.push(this.nuevoMiembro.trim());
                this.nuevoMiembro = '';
            }
        },

        removeMiembro(index) {
            this.form.miembros.splice(index, 1);
        },

        async registrarEquipo() {
            if (!this.form.nombre_equipo || !this.form.nombre_cohete) {
                return alert('Por favor, completa el nombre del equipo y el nombre del cohete.');
            }

            if (!Alpine.store('app').isTestMode && !this.fotoFile) {
                return alert('Por favor, sube una foto de evidencia.');
            }

            // BUG-02: Exigir las tres medidas antes de registrar (tanto en modo normal como en modo prueba)
            if (this.form.peso_cohete === '' || this.form.peso_cohete === null || this.form.peso_cohete === undefined ||
                this.form.altura_cohete === '' || this.form.altura_cohete === null || this.form.altura_cohete === undefined ||
                this.form.diametro_cohete === '' || this.form.diametro_cohete === null || this.form.diametro_cohete === undefined) {
                return alert('❌ ERROR: Debes ingresar el peso, la altura y el diámetro del cohete antes de registrar.');
            }

            // BUG-01: Validar números válidos, no NaN, mayores a 0 (evita negativos y ceros) y dentro del rango máximo permitido
            const peso = Number(this.form.peso_cohete);
            const altura = Number(this.form.altura_cohete);
            const diametro = Number(this.form.diametro_cohete);

            if (isNaN(peso) || peso <= 0 || peso > 400) {
                return alert('❌ ERROR: El peso debe ser un número mayor a 0 y máximo 400g.');
            }
            if (isNaN(altura) || altura <= 0 || altura > 75) {
                return alert('❌ ERROR: La altura debe ser un número mayor a 0 y máximo 75cm.');
            }
            if (isNaN(diametro) || diametro <= 0 || diametro > 12.5) {
                return alert('❌ ERROR: El diámetro debe ser un número mayor a 0 y máximo 12.5cm.');
            }

            if (Alpine.store('app').isTestMode) {
                const dummyPhoto = this.fotoFile ? URL.createObjectURL(this.fotoFile) : 'js/public/Patricinadores/Robokids.png';
                const mockTeam = {
                    id: 'mock-team-' + Date.now(),
                    ...this.form,
                    numero_registro: String(this.form.numero_registro || '').padStart(2, '0'),
                    peso_cohete: peso,
                    altura_cohete: altura,
                    diametro_cohete: diametro,
                    foto_evidencia: dummyPhoto,
                    is_test: true,
                    createdAt: { seconds: Math.floor(Date.now() / 1000) }
                };
                Alpine.store('app').teams.push(mockTeam);
                alert(`✅ [VISTA DE PRUEBA] Equipo "${mockTeam.nombre_equipo}" registrado exitosamente en la sesión de prueba.`);
                this.resetForm();
                return;
            }

            this.isSubmitting = true;

            try {
                const storagePath = `evidencias_cohetes/${Date.now()}_${this.fotoFile.name}`;
                const fileRef = storageRef(storage, storagePath);

                const uploadResult = await uploadBytes(fileRef, this.fotoFile);
                const downloadURL = await getDownloadURL(uploadResult.ref);

                await addDoc(collection(db, 'equipos'), {
                    ...this.form,
                    numero_registro: String(this.form.numero_registro || '').padStart(2, '0'),
                    peso_cohete: peso,
                    altura_cohete: altura,
                    diametro_cohete: diametro,
                    foto_evidencia: downloadURL,
                    createdAt: serverTimestamp()
                });

                alert('✅ Equipo registrado con éxito.');
                this.resetForm();

            } catch (error) {
                console.error("Error en registro:", error);
                alert('❌ Error al registrar el equipo: ' + error.message);
            } finally {
                this.isSubmitting = false;
            }
        }
    }));

    // ── Component: Resultados (Leaderboard Completo y Promedio de Jueces) ──
    Alpine.data('resultadosController', () => ({
        leaderboard: [],
        filtroCategoria: 'TODAS',
        isLoading: true,
        rawCalificaciones: [],

        get filteredLeaderboard() {
            let list = this.leaderboard;
            if (this.filtroCategoria !== 'TODAS' && this.filtroCategoria !== 'Todos') {
                list = list.filter(t => Alpine.store('app').matchesCategoria(t.categoria, this.filtroCategoria));
            }
            return list;
        },

        init() {
            // BUG-03: En modo prueba, calcular podio directamente desde Alpine.store('app').allCalificaciones
            if (Alpine.store('app').isTestMode) {
                this.rawCalificaciones = Alpine.store('app').allCalificaciones || [];
                this.procesarResultados(this.rawCalificaciones);
                this.isLoading = false;
            } else {
                const q = query(collection(db, 'calificaciones'));
                onSnapshot(q, (snapshot) => {
                    if (!Alpine.store('app').isTestMode) {
                        this.rawCalificaciones = snapshot.docs.map(d => d.data());
                        this.procesarResultados(this.rawCalificaciones);
                        this.isLoading = false;
                    }
                }, (err) => {
                    console.warn("Firestore snapshot error (calificaciones):", err);
                    if (Alpine.store('app').isTestMode) {
                        this.rawCalificaciones = Alpine.store('app').allCalificaciones || [];
                        this.procesarResultados(this.rawCalificaciones);
                    }
                    this.isLoading = false;
                });
            }

            // Escuchar cambios reactivos en allCalificaciones para actualizar en vivo el podio en modo prueba
            this.$watch('$store.app.allCalificaciones', (newCals) => {
                if (Alpine.store('app').isTestMode) {
                    this.rawCalificaciones = newCals || [];
                    this.procesarResultados(this.rawCalificaciones);
                    this.isLoading = false;
                }
            });

            this.$watch('$store.app.isTestMode', (isTest) => {
                if (isTest) {
                    this.rawCalificaciones = Alpine.store('app').allCalificaciones || [];
                    this.procesarResultados(this.rawCalificaciones);
                    this.isLoading = false;
                }
            });

            this.$watch('$store.app.teams', () => {
                const cals = Alpine.store('app').isTestMode 
                    ? (Alpine.store('app').allCalificaciones || []) 
                    : this.rawCalificaciones;
                if (cals.length > 0) {
                    this.procesarResultados(cals);
                }
            });

            this.$watch('$store.app.misionSeleccionada', () => {
                const cals = Alpine.store('app').isTestMode 
                    ? (Alpine.store('app').allCalificaciones || []) 
                    : this.rawCalificaciones;
                if (cals.length > 0) {
                    this.procesarResultados(cals);
                }
            });
        },

        // Calcula el promedio de las notas de los jurados independientes sin duplicar faltas
        procesarResultados(calificaciones) {
            const currentMission = Alpine.store('app').misionSeleccionada || 'Lanzamiento Vertical';
            const sourceCals = (Alpine.store('app').isTestMode && (!calificaciones || calificaciones.length === 0))
                ? (Alpine.store('app').allCalificaciones || [])
                : (calificaciones || []);
            const cals = sourceCals.filter(c => c.tipo === currentMission);
            const equiposBase = Alpine.store('app').teams;

            // Agrupar calificaciones por equipo y por juez
            const juecesPorEquipo = {}; 
            const launchDataPorEquipo = {};

            cals.forEach(c => {
                const teamId = c.id_equipo;
                if (!teamId) return;
                const juezKey = c.id_juez || c.nombre_juez || 'Juez_General';

                if (!juecesPorEquipo[teamId]) juecesPorEquipo[teamId] = {};

                const existing = juecesPorEquipo[teamId][juezKey];
                const tNew = c.createdAt?.seconds || 0;
                const tOld = existing?.createdAt?.seconds || 0;

                if (!existing || tNew >= tOld) {
                    juecesPorEquipo[teamId][juezKey] = c;
                }

                if (!launchDataPorEquipo[teamId]) {
                    launchDataPorEquipo[teamId] = { tiempo: 0, distancia: 0 };
                }
                if ((c.tiempo_vuelo || 0) > launchDataPorEquipo[teamId].tiempo) {
                    launchDataPorEquipo[teamId].tiempo = c.tiempo_vuelo;
                }
                if ((c.distancia || 0) > launchDataPorEquipo[teamId].distancia) {
                    launchDataPorEquipo[teamId].distancia = c.distancia;
                }
            });

            let lista = equiposBase.map(team => {
                const teamCalsObj = juecesPorEquipo[team.id] || {};
                const calsList = Object.values(teamCalsObj);
                const ld = launchDataPorEquipo[team.id] || { 
                    tiempo: team.tiempo_vuelo_cronometro || 0, 
                    distancia: team.distancia_cronometro || 0 
                };

                let totalScoreSum = 0;
                let totalFaltasSum = 0;
                let isDescalificado = false;

                calsList.forEach(cal => {
                    if (cal.descalificado) isDescalificado = true;
                    // cal.totalScore ya incluye las faltas restadas una sola vez
                    totalScoreSum += Number(cal.totalScore || 0);
                    totalFaltasSum += Number(cal.faltas || 0);
                });

                // PROMEDIO entre jueces que evaluaron
                const numJueces = calsList.length;
                let scoreFinal = 0;
                if (numJueces > 0 && !isDescalificado) {
                    scoreFinal = Math.round((totalScoreSum / numJueces) * 10) / 10;
                }

                const avgFaltas = numJueces > 0 ? (totalFaltasSum / numJueces).toFixed(1) : 0;

                return {
                    id: team.id,
                    numero_registro: team.numero_registro || '',
                    nombre: Alpine.store('app').formatTeamName(team),
                    nombre_cohete: team.nombre_cohete || '',
                    categoria: team.categoria,
                    score: scoreFinal,
                    tiempo: ld.tiempo || team.tiempo_vuelo_cronometro || 0,
                    distancia: ld.distancia || team.distancia_cronometro || 0,
                    descalificado: isDescalificado,
                    evaluacionesCount: numJueces,
                    faltas: avgFaltas,
                    foto: team.foto_evidencia || ''
                };
            });

            // Ordenar por puntaje descendente
            lista.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (Alpine.store('app').misionSeleccionada === 'Tiro Parabólico') {
                    return b.distancia - a.distancia;
                }
                return b.tiempo - a.tiempo;
            });

            this.leaderboard = lista;
        },

        formatTime(ms) {
            const totalSeconds = ms / 1000;
            return totalSeconds.toFixed(2) + 's';
        }
    }));

    // ── Component: Resultados Finales (Combinados con Promedio de Jueces) ───
    Alpine.data('resultadosFinalesController', () => ({
        combinedLeaderboard: [],
        filtroCategoria: 'TODAS',
        isLoading: true,
        activeSubTab: 'combinados',
        rawCalificaciones: [],

        get filteredCombined() {
            let list = this.combinedLeaderboard;
            if (this.filtroCategoria !== 'TODAS' && this.filtroCategoria !== 'Todos') {
                list = list.filter(t => Alpine.store('app').matchesCategoria(t.categoria, this.filtroCategoria));
            }
            return list;
        },

        podiumCategoria(cat) {
            const filtered = this.combinedLeaderboard.filter(t => Alpine.store('app').matchesCategoria(t.categoria, cat));
            return filtered.slice(0, 3);
        },

        init() {
            // BUG-03: En modo prueba, calcular podio y resultados combinados directamente desde Alpine.store('app').allCalificaciones
            if (Alpine.store('app').isTestMode) {
                this.rawCalificaciones = Alpine.store('app').allCalificaciones || [];
                this.procesarResultadosCombinados(this.rawCalificaciones);
                this.isLoading = false;
            } else {
                const q = query(collection(db, 'calificaciones'));
                onSnapshot(q, (snapshot) => {
                    if (!Alpine.store('app').isTestMode) {
                        this.rawCalificaciones = snapshot.docs.map(d => d.data());
                        this.procesarResultadosCombinados(this.rawCalificaciones);
                        this.isLoading = false;
                    }
                }, (err) => {
                    console.warn("Firestore snapshot error (calificaciones finales):", err);
                    if (Alpine.store('app').isTestMode) {
                        this.rawCalificaciones = Alpine.store('app').allCalificaciones || [];
                        this.procesarResultadosCombinados(this.rawCalificaciones);
                    }
                    this.isLoading = false;
                });
            }

            // Escuchar cambios reactivos en allCalificaciones para actualizar en vivo el podio combinado
            this.$watch('$store.app.allCalificaciones', (newCals) => {
                if (Alpine.store('app').isTestMode) {
                    this.rawCalificaciones = newCals || [];
                    this.procesarResultadosCombinados(this.rawCalificaciones);
                    this.isLoading = false;
                }
            });

            this.$watch('$store.app.isTestMode', (isTest) => {
                if (isTest) {
                    this.rawCalificaciones = Alpine.store('app').allCalificaciones || [];
                    this.procesarResultadosCombinados(this.rawCalificaciones);
                    this.isLoading = false;
                }
            });

            this.$watch('$store.app.teams', () => {
                const cals = Alpine.store('app').isTestMode 
                    ? (Alpine.store('app').allCalificaciones || []) 
                    : this.rawCalificaciones;
                if (cals.length > 0) {
                    this.procesarResultadosCombinados(cals);
                }
            });
        },

        procesarResultadosCombinados(calificaciones) {
            const sourceCals = (Alpine.store('app').isTestMode && (!calificaciones || calificaciones.length === 0))
                ? (Alpine.store('app').allCalificaciones || [])
                : (calificaciones || []);
            const equiposBase = Alpine.store('app').teams;

            // Agrupar por equipo y misión: { [teamId]: { 'Lanzamiento Vertical': { [judgeId]: cal }, 'Tiro Parabólico': { [judgeId]: cal } } }
            const calsPorEquipo = {};

            calificaciones.forEach(c => {
                const id = c.id_equipo;
                if (!id) return;
                const tipo = c.tipo || 'Lanzamiento Vertical';
                const juez = c.id_juez || c.nombre_juez || 'Juez_General';

                if (!calsPorEquipo[id]) {
                    calsPorEquipo[id] = { 'Lanzamiento Vertical': {}, 'Tiro Parabólico': {} };
                }

                if (!calsPorEquipo[id][tipo]) calsPorEquipo[id][tipo] = {};

                const existing = calsPorEquipo[id][tipo][juez];
                const tNew = c.createdAt?.seconds || 0;
                const tOld = existing?.createdAt?.seconds || 0;

                if (!existing || tNew >= tOld) {
                    calsPorEquipo[id][tipo][juez] = c;
                }
            });

            let lista = equiposBase.map(team => {
                const teamData = calsPorEquipo[team.id] || { 'Lanzamiento Vertical': {}, 'Tiro Parabólico': {} };
                const calsVert = Object.values(teamData['Lanzamiento Vertical'] || {});
                const calsPara = Object.values(teamData['Tiro Parabólico'] || {});

                // Lanzamiento Vertical Promedio
                let sumVert = 0;
                let descalificadoV = false;
                calsVert.forEach(c => {
                    if (c.descalificado) descalificadoV = true;
                    sumVert += Number(c.totalScore || 0);
                });
                const scoreVertical = (calsVert.length > 0 && !descalificadoV) 
                    ? Math.round((sumVert / calsVert.length) * 10) / 10 
                    : 0;

                // Tiro Parabólico Promedio
                let sumPara = 0;
                let descalificadoP = false;
                calsPara.forEach(c => {
                    if (c.descalificado) descalificadoP = true;
                    sumPara += Number(c.totalScore || 0);
                });
                const scoreParabolico = (calsPara.length > 0 && !descalificadoP) 
                    ? Math.round((sumPara / calsPara.length) * 10) / 10 
                    : 0;

                const totalCombinado = Math.round((scoreVertical + scoreParabolico) * 10) / 10;

                return {
                    id: team.id,
                    numero_registro: team.numero_registro || '',
                    nombre: Alpine.store('app').formatTeamName(team),
                    nombre_cohete: team.nombre_cohete || '',
                    categoria: team.categoria,
                    puntosVertical: scoreVertical,
                    puntosParabolico: scoreParabolico,
                    totalCombinado: totalCombinado,
                    descalificadoVertical: descalificadoV,
                    descalificadoParabolico: descalificadoP,
                    juecesVertical: calsVert.length,
                    juecesParabolico: calsPara.length,
                    foto: team.foto_evidencia || ''
                };
            });

            // Ordenar por total combinado descendente
            lista.sort((a, b) => b.totalCombinado - a.totalCombinado);

            this.combinedLeaderboard = lista;
        }
    }));

    // ── Component: Header y Gestión de Perfil ─────────────────
    Alpine.data('headerController', () => ({
        showUserMenu: false,
        showEditProfileModal: false,
        isFullScreen: false,
        isUpdating: false,
        newAvatarFile: null,
        userToEdit: null,

        init() {
            document.addEventListener('profiles:updated', (e) => {
                if (this.userToEdit) {
                    const updated = e.detail.liveUsers.find(u => u.email && u.email.toLowerCase() === this.userToEdit.email?.toLowerCase());
                    if (updated) {
                        this.userToEdit = { ...this.userToEdit, ...updated };
                    }
                }
            });
        },

        toggleFullScreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().then(() => {
                    this.isFullScreen = true;
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                    this.isFullScreen = false;
                }
            }
        },

        async logout() {
            if (confirm('¿Cerrar sesión?')) {
                Alpine.store('app').logout();
            }
        },

        async updateAvatar() {
            if (!this.newAvatarFile) return;

            const currentUser = auth.currentUser;
            if (!currentUser) return alert('Debes estar autenticado.');

            const targetUser = this.userToEdit || { 
                email: currentUser.email, 
                uid: currentUser.uid, 
                name: currentUser.displayName || 'Usuario',
                role: Alpine.store('app').userRole
            };

            this.isUpdating = true;
            console.log("🚀 Iniciando carga de avatar para:", targetUser.email);

            try {
                const safeEmail = targetUser.email.toLowerCase();
                const path = `avatares/${safeEmail}_${Date.now()}`;
                const fileRef = storageRef(storage, path);

                const uploadResult = await uploadBytes(fileRef, this.newAvatarFile);
                let downloadURL = await getDownloadURL(uploadResult.ref);
                const finalPhotoURL = `${downloadURL}&v=${Date.now()}`;

                // 1. Si se está editando a sí mismo, actualizar perfil de Auth
                if (currentUser.email.toLowerCase() === safeEmail) {
                    await updateProfile(currentUser, { photoURL: finalPhotoURL });
                    Alpine.store('app').user = { ...currentUser, photoURL: finalPhotoURL };
                }

                // 2. Localizar o crear registro en Firestore
                let docRef;
                let existingData = {};

                if (targetUser.uid) {
                    docRef = doc(db, 'systemUsers', targetUser.uid);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) existingData = snap.data();
                } else {
                    const q = query(collection(db, 'systemUsers'), where('email', '==', safeEmail));
                    const snap = await getDocs(q);
                    if (!snap.empty) {
                        docRef = doc(db, 'systemUsers', snap.docs[0].id);
                        existingData = snap.docs[0].data();
                    } else {
                        docRef = doc(collection(db, 'systemUsers'));
                    }
                }

                let finalName = targetUser.name || existingData.name || 'Usuario';
                if (safeEmail === 'jurado1@tirr.com' && finalName === 'J.E.D.') {
                    finalName = 'Jurado 1';
                }

                const updatedData = {
                    email: safeEmail,
                    name: finalName,
                    role: targetUser.role || existingData.role || 'INVITADO',
                    photoURL: finalPhotoURL,
                    updatedAt: serverTimestamp()
                };

                await setDoc(docRef, updatedData, { merge: true });

                if (this.userToEdit) {
                    this.userToEdit = { ...this.userToEdit, ...updatedData };
                }

                console.log("✅ Avatar actualizado con éxito.");
                alert('¡Foto actualizada correctamente!');
                this.newAvatarFile = null;
                this.showEditProfileModal = false;
            } catch (err) {
                console.error("❌ Error al actualizar avatar:", err);
                alert('Error al cargar la imagen: ' + err.message);
            } finally {
                this.isUpdating = false;
            }
        },

        async resetPlatformData() {
            if (!confirm('⚠️ ¿ESTÁS SEGURO? Esta acción borrará TODOS los equipos, calificaciones y resets de perfiles. El sistema quedará vacío.')) return;
            const confirm2 = prompt('Para confirmar, escribe "REINICIAR":');
            if (confirm2 !== 'REINICIAR') return;

            this.isUpdating = true;
            try {
                console.log("Iniciando purga total de datos...");

                // 1. Limpiar Equipos
                const equiposSnap = await getDocs(collection(db, 'equipos'));
                for (const d of equiposSnap.docs) {
                    await deleteDoc(doc(db, 'equipos', d.id));
                }

                // 2. Limpiar Calificaciones
                const calSnap = await getDocs(collection(db, 'calificaciones'));
                for (const d of calSnap.docs) {
                    await deleteDoc(doc(db, 'calificaciones', d.id));
                }

                // 3. Limpiar fotos de perfil en Firestore (systemUsers)
                const usersSnap = await getDocs(collection(db, 'systemUsers'));
                for (const d of usersSnap.docs) {
                    await updateDoc(doc(db, 'systemUsers', d.id), {
                        photoURL: null,
                        updatedAt: serverTimestamp()
                    });
                }

                // 4. Limpiar fotos en Firebase Auth (usuario actual)
                if (auth.currentUser) {
                    await updateProfile(auth.currentUser, { photoURL: null });
                }

                // 5. Limpiar RTDB Active Launch en todas las ramas de misiones
                await set(ref(rtdb, 'active_launch'), null);
                await set(ref(rtdb, 'active_launch_Lanzamiento_Vertical'), null);
                await set(ref(rtdb, 'active_launch_Tiro_Parabolico'), null);

                // 6. Limpiar Cache Local
                clearSessionData();
                localStorage.clear();

                alert('✅ Sistema reiniciado con éxito. La plataforma está totalmente limpia.');
                window.location.reload();
            } catch (err) {
                console.error("Error en reset crítico:", err);
                alert('❌ Error al reiniciar: ' + err.message);
            } finally {
                this.isUpdating = false;
            }
        }
    }));
}

// ── Systematic AI / External Testing Interface ────────────────
if (typeof window !== 'undefined') {
    window.__TIRR_TEST_API__ = {
        login() {
            return Alpine.store('app').loginAsVistaPrueba();
        },
        logout() {
            return Alpine.store('app').logout();
        },
        reset() {
            return Alpine.store('app').resetTestState();
        },
        getProfile() {
            const s = Alpine.store('app');
            return {
                name: 'Vista de Prueba',
                role: s.userRole,
                isTestMode: s.isTestMode,
                isAuthenticated: s.isAuthenticated,
                activeMission: s.misionSeleccionada,
                teamsCount: s.teams.length,
                calificacionesCount: s.allCalificaciones.length
            };
        },
        getModules() {
            const s = Alpine.store('app');
            const list = ['dashboard', 'registro', 'cronometro', 'calificacion_lista', 'calificacion', 'equipos', 'resultados', 'resultados_finales'];
            return list.map(m => ({ module: m, hasAccess: s.hasAccess(m) }));
        },
        navigate(tabName) {
            localStorage.setItem('activeTab', tabName);
            const el = document.querySelector('[x-data*="activeTab"]');
            if (el && el._x_dataStack && el._x_dataStack[0]) {
                el._x_dataStack[0].activeTab = tabName;
                return true;
            }
            return false;
        },
        setMission(mission) {
            Alpine.store('app').setMision(mission);
            return true;
        },
        runDiagnostics() {
            const s = Alpine.store('app');
            const checks = [
                { name: 'Perfil Activo es Vista de Prueba', passed: s.userRole === 'VISTA DE PRUEBA' },
                { name: 'Acceso a Panel Principal (dashboard)', passed: s.hasAccess('dashboard') },
                { name: 'Acceso a Registro de Equipos', passed: s.hasAccess('registro') },
                { name: 'Acceso a Cronometría Oficial', passed: s.hasAccess('cronometro') },
                { name: 'Acceso a Calificación tipo Lista', passed: s.hasAccess('calificacion_lista') },
                { name: 'Acceso a Calificación Individual', passed: s.hasAccess('calificacion') },
                { name: 'Acceso a Directorio de Equipos', passed: s.hasAccess('equipos') },
                { name: 'Acceso a Resultados y Podio', passed: s.hasAccess('resultados') },
                { name: 'Acceso a Resultados Finales', passed: s.hasAccess('resultados_finales') },
                { name: 'Equipos disponibles para interacción', passed: s.teams.length > 0 },
                { name: 'Calificaciones disponibles para análisis', passed: s.allCalificaciones.length > 0 },
                { name: 'Validación de Medidas (BUG-01, BUG-02)', passed: typeof s.teams[0]?.peso_cohete === 'number' && s.teams.every(t => t.peso_cohete > 0 && t.altura_cohete > 0 && t.diametro_cohete > 0) },
                { name: 'Sincronización de Podio desde Store (BUG-03)', passed: s.allCalificaciones.some(c => c.tipo === 'Lanzamiento Vertical') && s.allCalificaciones.some(c => c.tipo === 'Tiro Parabólico') }
            ];
            const allPassed = checks.every(c => c.passed);
            const summary = {
                status: allPassed ? 'PASS' : 'WARN',
                timestamp: new Date().toISOString(),
                totalChecks: checks.length,
                passedChecks: checks.filter(c => c.passed).length,
                checks
            };
            console.log("🧪 DIAGNÓSTICO SISTEMÁTICO TIRR (VISTA DE PRUEBA):", summary);
            return summary;
        }
    };
    console.log("🧪 [TIRR] Vista de Prueba y API para IA listas. Accesible vía window.__TIRR_TEST_API__");
}

// Inicializar cuando Alpine esté listo
if (window.Alpine) {
    initTIRR();
} else {
    document.addEventListener('alpine:init', initTIRR);
}

export { initTIRR };

