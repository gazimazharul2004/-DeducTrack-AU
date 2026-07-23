(function () {
    var firebaseConfig = {
        apiKey: "AIzaSyDummyKeyForPreviewModeOnly12345",
        authDomain: "deductrack-au.firebaseapp.com",
        projectId: "deductrack-au",
        storageBucket: "deductrack-au.appspot.com",
        messagingSenderId: "1234567890",
        appId: "1:1234567890:web:1234567890"
    };

    if (typeof firebase === 'undefined') {
        console.warn('Firebase SDK not loaded.');
        return;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        var auth = firebase.auth();
        var db = firebase.firestore();

        window.DTCloudUser = null;

        auth.onAuthStateChanged(function (user) {
            window.DTCloudUser = user;
            window.dispatchEvent(new CustomEvent('dt-auth-change', { detail: user }));
        });

        window.DTCloud = {
            googleSignIn: function () {
                var provider = new firebase.auth.GoogleAuthProvider();
                return auth.signInWithPopup(provider);
            },
            emailSignIn: function (email, password) {
                return auth.signInWithEmailAndPassword(email, password);
            },
            emailSignUp: function (email, password) {
                return auth.createUserWithEmailAndPassword(email, password);
            },
            signOut: function () {
                return auth.signOut();
            },
            saveInvoice: function (invoice) {
                if (!window.DTCloudUser) return Promise.reject('User not logged in');
                var data = Object.assign({}, invoice);
                delete data.image; // Keep images local to prevent Firestore document size limit issues
                return db.collection('users').doc(window.DTCloudUser.uid)
                    .collection('invoices').doc(String(invoice.id))
                    .set(data, { merge: true });
            },
            deleteInvoice: function (id) {
                if (!window.DTCloudUser) return Promise.reject('User not logged in');
                return db.collection('users').doc(window.DTCloudUser.uid)
                    .collection('invoices').doc(String(id)).delete();
            },
            getInvoices: function () {
                if (!window.DTCloudUser) return Promise.resolve([]);
                return db.collection('users').doc(window.DTCloudUser.uid)
                    .collection('invoices').get()
                    .then(function (snapshot) {
                        var items = [];
                        snapshot.forEach(function (doc) {
                            items.push(doc.data());
                        });
                        return items;
                    });
            }
        };
    } catch (e) {
        console.warn('Firebase init error', e);
    }
})();
