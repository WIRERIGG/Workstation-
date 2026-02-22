use iced::{Element, Task, Theme, Size};
use iced::widget::{container, text};

fn main() -> iced::Result {
    tracing_subscriber::fmt::init();

    iced::application(Wiredash::new, Wiredash::update, Wiredash::view)
        .title("Wiredash")
        .theme(Wiredash::theme)
        .window_size(Size::new(1200.0, 800.0))
        .centered()
        .run()
}

struct Wiredash {
    placeholder: String,
}

#[derive(Debug, Clone)]
enum Message {}

impl Wiredash {
    fn new() -> (Self, Task<Message>) {
        (
            Self {
                placeholder: "Wiredash is starting...".into(),
            },
            Task::none(),
        )
    }

    fn update(&mut self, _message: Message) -> Task<Message> {
        Task::none()
    }

    fn view(&self) -> Element<'_, Message> {
        container(
            text(&self.placeholder).size(24),
        )
        .center_x(iced::Fill)
        .center_y(iced::Fill)
        .into()
    }

    fn theme(&self) -> Theme {
        Theme::Dark
    }
}
