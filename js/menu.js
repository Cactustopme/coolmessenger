import { getThisUserData } from './api.js';
import { showProfilePage, displayUserProfile, hideProfilePage } from './ui.js';

export function initMenu() {
    const menuBtn = document.getElementById('menuBtn');
    const menuModal = document.getElementById('menuModal');
    const closeMenuBtn = document.getElementById('closeMenuBtn');

    if (!menuBtn || !menuModal) return;

    menuBtn.addEventListener('click', () => { menuModal.style.display = 'flex'; });
    closeMenuBtn.addEventListener('click', () => { menuModal.style.display = 'none'; });
    menuModal.addEventListener('click', (e) => {
        if (e.target === menuModal) menuModal.style.display = 'none';
    });

    document.getElementById('menuProfile')?.addEventListener('click', async () => {
        try {
            const userData = await getThisUserData();
            if (userData.result === 'SUCCESS') {
                await displayUserProfile(userData);
                showProfilePage();
            } else {
                alert('❌ Не удалось загрузить профиль');
            }
        } catch (error) {
            console.error('Ошибка загрузки профиля:', error);
            alert('❌ Ошибка: ' + (error.message || 'Не удалось загрузить профиль'));
        }
        menuModal.style.display = 'none';
    });
    document.getElementById('menuTheme')?.addEventListener('click', () => {
        alert('🎨 Смена темы: скоро появится!');
        menuModal.style.display = 'none';
    });
    document.getElementById('menuLogout')?.addEventListener('click', () => {
        if (confirm('Вы уверены, что хотите выйти?')) {
            window.logout?.();
            menuModal.style.display = 'none';
        }
    });
}