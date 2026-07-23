(function () {
  try {
    const firebaseConfig = {
      apiKey: 'AIzaSyA1AqEav5ufpoWjdhh6nku3r0bapshNBec',
      authDomain: 'deductrack.firebaseapp.com',
      projectId: 'deductrack',
      storageBucket: 'deductrack.firebasestorage.app',
      messagingSenderId: '330001899595',
      appId: '1:330001899595:web:225cde17bc96ea33596dce',
      measurementId: 'G-7JL70D11FK'
    };
    if (typeof firebase !== 'undefined') {
      firebase.initializeApp(firebaseConfig);
      const auth = firebase.auth();
      const db = firebase.firestore();
      const provider = new firebase.auth.GoogleAuthProvider();

      function publicInvoice(invoice) {
        const copy = Object.assign({}, invoice);
        delete copy.image;
        return copy;
      }

      window.DTCloud = {
        emailSignIn: (email, password) => auth.signInWithEmailAndPassword(email, password),
        emailSignUp: (email, password) => auth.createUserWithEmailAndPassword(email, password),
        googleSignIn: () => auth.signInWithPopup(provider),
        signOut: () => auth.signOut(),
        getInvoices: async () => {
          if (!auth.currentUser) return [];
          const snapshot = await db.collection('users').doc(auth.currentUser.uid).collection('invoices').get();
          return snapshot.docs.map(item => item.data());
        },
        saveInvoice: async invoice => {
          if (!auth.currentUser || !invoice || !invoice.id) return;
          const clean = publicInvoice(invoice);
          clean.cloudUpdatedAt = Date.now();
          await db.collection('users').doc(auth.currentUser.uid).collection('invoices').doc(String(invoice.id)).set(clean);
        },
        deleteInvoice: async invoiceId => {
          if (!auth.currentUser) return;
          await db.collection('users').doc(auth.currentUser.uid).collection('invoices').doc(String(invoiceId)).delete();
        }
      };

      auth.onAuthStateChanged(function (user) {
        window.DTCloudUser = user || null;
        window.dispatchEvent(new CustomEvent('dt-auth-change', { detail: user || null }));
      });
    }
  } catch (error) {
    window.DTCloudError = error;
    console.error('Firebase failed to start:', error);
  }
})();
