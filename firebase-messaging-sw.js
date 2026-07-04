importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyArL1xQgclF0tshvGoZPRmIlCSfzr0TAps",
    authDomain: "splitfool-4ca6b.firebaseapp.com",
    projectId: "splitfool-4ca6b",
    storageBucket: "splitfool-4ca6b.firebasestorage.app",
    messagingSenderId: "544504211257",
    appId: "1:544504211257:web:94d93ff317d28d91ebeae8",
    measurementId: "G-C7HF3N3X7N"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/store_icon.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
