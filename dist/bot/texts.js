export const buttonText = {
    submitApplication: "Подать анкету",
    reserveRole: "Забронировать роль",
    rules: "Правила",
    infoChannel: "Инфо-канал",
    lifeChannel: "Лайф-канал",
    help: "Помощь",
    checkSubscription: "Проверить подписку",
    confirm: "Подтвердить",
    approve: "Одобрить",
    reject: "Отказать",
    approveReservation: "Одобрить бронь",
    recheckSubscriptions: "Перепроверить подписки",
    profile: "Профиль",
    other: "Другое",
    actual: "Актуальна",
    notActual: "Неактуальна",
    extendReservation: "Продлить бронь",
    appeal: "Оспорить",
    contact: "Связаться",
};
export const applicationRejectReasons = {
    sub: "Не подписан на каналы",
    code: "Неверное кодовое слово",
    bad: "Неподходящая анкета",
    risk: "Подозрительный аккаунт",
};
export const reservationRejectReasons = {
    role: "Роль нельзя забронировать",
    long: "Слишком долгий срок брони",
    badrole: "Неверно указана роль",
    risk: "Подозрительный аккаунт",
};
export const applicationStatusText = {
    pending: "ожидает проверки",
    approved: "ссылка отправлена, ждём заявку в основной чат",
    rejected: "отклонена",
    joined: "принята, пользователь вступил в чат",
};
export const reservationStatusText = {
    pending: "ожидает проверки",
    approved: "одобрена",
    rejected: "отклонена",
    expired: "истекла",
    used: "использована",
};
export const joinRequestStatusText = {
    pending: "ожидает проверки",
    approved: "принята",
    rejected: "отклонена",
};
export const inviteLinkStatusText = {
    active: "активна",
    used: "использована",
    revoked: "отозвана",
    expired: "истекла",
};
export const adminTitleText = {
    developer: "разработчик",
    owner: "владелец",
    coOwner: "со.владелец",
    senior: "старший админ",
    junior: "младший админ",
    admin: "админ",
};
export const commonText = {
    applicationNotFound: "Анкета не найдена",
    reservationNotFound: "Бронь не найдена",
    userNotFound: "Пользователь не найден",
    alreadyReviewed: "Заявка уже была рассмотрена",
    subscriptionRechecked: "Подписки перепроверены",
    otherReason: buttonText.other,
    adminOnlyButton: "Эта кнопка доступна только администрации",
    adminOnlyCommand: "Эта команда доступна только администрации.",
};
export const callbackText = {
    useHelpOrMenu: "Используйте /help или выберите действие в меню.",
    noActiveUsernameStep: "Нет активного шага с username",
    joinRequestsAcceptedManually: "Теперь заявки принимаются вручную в Telegram.",
    joinRequestsDeclinedManually: "Теперь заявки отклоняются вручную в Telegram.",
    subscriptionsCheckedChooseMenu: "Подписки проверены. Выберите действие в меню.",
    approvalChecksFailed: "Проверка не пройдена",
    inviteCreationError: "Ошибка создания ссылки",
    applicationApproved: "Анкета одобрена",
    applicationRejected: "Анкета отклонена",
    chooseRejectReason: "<b>Выберите причину отказа:</b>",
    reservationApproved: "Бронь одобрена",
    reservationRejected: "Бронь отклонена",
    reservationUnavailable: "Бронь не найдена или недоступна",
    reservationInactive: "Эта бронь уже не активна",
    waitlistReturned: "Бронь вернулась в очередь",
    linkCreationFailed: "Не удалось создать ссылку",
    linkSent: "Ссылка отправлена",
    reservationDeleted: "Бронь удалена",
    datedReservationCannotExtend: "Эта бронь без даты, её нельзя продлить",
    usernameRequired: "Сначала установите @username",
    appealSent: "Обращение отправлено администрации",
};
